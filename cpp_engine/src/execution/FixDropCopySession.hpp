#pragma once

#include "FixEngine.hpp"
#include "FixMessage.hpp"
#include "../trading/OrderTypes.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <iomanip>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace quantos::fix {

// ─── Drop Copy Execution Record (Standard Clearing Format) ────────────────────
struct DropCopyRecord {
    std::string cl_ord_id;         // Tag 11
    std::string broker_order_id;   // Tag 37
    std::string exec_id;           // Tag 17
    char exec_type = '0';          // Tag 150: '0'=New, '1'=Partial, '2'=Fill, '4'=Cancelled, '5'=Replaced, '8'=Rejected
    char ord_status = '0';         // Tag 39
    std::string symbol;            // Tag 55
    char side = '1';               // Tag 54: '1'=Buy, '2'=Sell, '5'=Short Sell
    double last_qty = 0.0;         // Tag 32
    double last_px  = 0.0;         // Tag 31
    double cum_qty  = 0.0;         // Tag 14
    double leaves_qty = 0.0;       // Tag 151
    double avg_px   = 0.0;         // Tag 6
    std::string transact_time;     // Tag 60
    std::string account;           // Tag 1
    std::string clearing_firm;     // Tag 439: "CITCO", "SSC", "BNY_MELLON"
    std::string clearing_account;  // Tag 440
    std::string text;              // Tag 58
    uint64_t seq_num = 0;          // Tag 34
    uint64_t received_at_ns = 0;
};

// ─── FixDropCopySession: Institutional Clearing & Shadow NAV Feed ──────────────
class FixDropCopySession {
public:
    struct Config {
        Config() = default;
        std::string sender_comp_id   = "QE_DROPMONITOR_PROD";
        std::string target_comp_id   = "GS_GSET_DROPCOPY";
        std::string clearing_admin   = "CITCO_FUND_SERVICES"; // "CITCO", "SSC", "BNY_MELLON"
        std::string fund_account_id  = "TIER1_ALPHA_LP";
        bool auto_reconnect          = true;
    };

    FixDropCopySession()
        : FixDropCopySession(Config{}) {}

    explicit FixDropCopySession(Config cfg)
        : cfg_(std::move(cfg)),
          is_connected_(false),
          expected_in_seq_(1),
          total_reports_processed_(0),
          total_notional_cleared_(0.0) {}

    bool is_connected() const noexcept { return is_connected_.load(std::memory_order_relaxed); }
    void set_connected(bool c) noexcept { is_connected_.store(c, std::memory_order_release); }

    const Config& config() const noexcept { return cfg_; }
    uint64_t next_expected_seq() const noexcept { return expected_in_seq_.load(std::memory_order_relaxed); }
    uint64_t total_reports() const noexcept { return total_reports_processed_.load(std::memory_order_relaxed); }
    double total_notional_cleared() const noexcept { return total_notional_cleared_.load(std::memory_order_relaxed); }

    // Ingests raw Tag 35=8 Execution Report from the drop copy connection
    bool ingest_execution_report(const FixMessage& msg) {
        std::string_view msg_type = msg.msg_type();
        if (msg_type != "8") {
            return false; // Not an Execution Report
        }

        DropCopyRecord rec{};
        rec.seq_num = static_cast<uint64_t>(msg.get_int(tags::MsgSeqNum).value_or(0));
        rec.cl_ord_id = std::string(msg.get_string(tags::ClOrdID).value_or(""));
        rec.broker_order_id = std::string(msg.get_string(tags::OrderID).value_or(""));
        rec.exec_id = std::string(msg.get_string(tags::ExecID).value_or(""));
        rec.symbol = std::string(msg.get_string(tags::Symbol).value_or(""));
        rec.account = std::string(msg.get_string(tags::Account).value_or(cfg_.fund_account_id));
        rec.clearing_firm = cfg_.clearing_admin;
        rec.clearing_account = cfg_.fund_account_id;

        auto exec_type_sv = msg.get_string(tags::ExecType);
        if (exec_type_sv.has_value() && !exec_type_sv->empty()) {
            rec.exec_type = (*exec_type_sv)[0];
        }

        auto ord_status_sv = msg.get_string(tags::OrdStatus);
        if (ord_status_sv.has_value() && !ord_status_sv->empty()) {
            rec.ord_status = (*ord_status_sv)[0];
        }

        auto side_sv = msg.get_string(tags::Side);
        if (side_sv.has_value() && !side_sv->empty()) {
            rec.side = (*side_sv)[0];
        }

        rec.last_qty   = msg.get_double(tags::LastQty).value_or(0.0);
        rec.last_px    = msg.get_double(tags::LastPx).value_or(0.0);
        rec.cum_qty    = msg.get_double(tags::CumQty).value_or(0.0);
        rec.leaves_qty = msg.get_double(tags::LeavesQty).value_or(0.0);
        rec.avg_px     = msg.get_double(tags::AvgPx).value_or(0.0);
        rec.transact_time = std::string(msg.get_string(tags::TransactTime).value_or(""));
        rec.text       = std::string(msg.get_string(tags::Text).value_or(""));

        auto now_pt = std::chrono::high_resolution_clock::now().time_since_epoch();
        rec.received_at_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(now_pt).count();

        // Update Sequence Number state
        uint64_t expected = expected_in_seq_.load(std::memory_order_relaxed);
        if (rec.seq_num >= expected) {
            expected_in_seq_.store(rec.seq_num + 1, std::memory_order_relaxed);
        }

        // Update Clearing Metrics
        double notional = rec.last_qty * rec.last_px;
        if (notional > 0.0) {
            double current_total = total_notional_cleared_.load(std::memory_order_relaxed);
            total_notional_cleared_.store(current_total + notional, std::memory_order_relaxed);
        }
        total_reports_processed_.fetch_add(1, std::memory_order_relaxed);

        // Store Record Thread-Safely
        {
            std::unique_lock lock(mutex_);
            records_.push_back(rec);
            by_exec_id_[rec.exec_id] = rec;
            by_cl_ord_id_[rec.cl_ord_id] = rec;
        }

        return true;
    }

    // Export shadow NAV trade blotter to Citco / SS&C / BNY Mellon CSV format
    std::string export_fund_admin_csv() const {
        std::shared_lock lock(mutex_);
        std::ostringstream ss;
        ss << "SEQ_NUM,TIMESTAMP,ACCOUNT,CLEARING_FIRM,CL_ORD_ID,BROKER_ORD_ID,EXEC_ID,SYMBOL,SIDE,STATUS,LAST_QTY,LAST_PX,CUM_QTY,AVG_PX,NOTIONAL\n";

        for (const auto& r : records_) {
            double notional = r.last_qty * r.last_px;
            ss << r.seq_num << ","
               << r.transact_time << ","
               << r.account << ","
               << r.clearing_firm << ","
               << r.cl_ord_id << ","
               << r.broker_order_id << ","
               << r.exec_id << ","
               << r.symbol << ","
               << (r.side == '1' ? "BUY" : (r.side == '5' ? "SHORT_SELL" : "SELL")) << ","
               << r.ord_status << ","
               << std::fixed << std::setprecision(4) << r.last_qty << ","
               << std::fixed << std::setprecision(4) << r.last_px << ","
               << std::fixed << std::setprecision(4) << r.cum_qty << ","
               << std::fixed << std::setprecision(4) << r.avg_px << ","
               << std::fixed << std::setprecision(2) << notional << "\n";
        }
        return ss.str();
    }

    std::vector<DropCopyRecord> get_records(size_t limit = 100) const {
        std::shared_lock lock(mutex_);
        if (records_.size() <= limit) return records_;
        return std::vector<DropCopyRecord>(records_.end() - limit, records_.end());
    }

private:
    Config cfg_;
    std::atomic<bool> is_connected_;
    std::atomic<uint64_t> expected_in_seq_;
    std::atomic<uint64_t> total_reports_processed_;
    std::atomic<double> total_notional_cleared_;

    mutable std::shared_mutex mutex_;
    std::vector<DropCopyRecord> records_;
    std::unordered_map<std::string, DropCopyRecord> by_exec_id_;
    std::unordered_map<std::string, DropCopyRecord> by_cl_ord_id_;
};

// ─── Automated FIX Conformance Test Suite ─────────────────────────────────────
// Enforces compliance with FIX 4.4 specifications across:
// 1. Tag 141 ResetSeqNumFlag=Y (Logon sequence reset)
// 2. Tag 35=2 ResendRequest (Sequence gaps detection)
// 3. Tag 35=4 SequenceReset with Tag 123 GapFillFlag=Y
// 4. Tag 35=G Order Cancel/Replace and Tag 35=9 Cancel Reject
class FixConformanceHarness {
public:
    struct ConformanceResult {
        bool all_passed = true;
        std::vector<std::string> passed_tests;
        std::vector<std::string> failed_tests;
    };

    static ConformanceResult run_all_conformance_tests() {
        ConformanceResult result{};

        // Test 1: Tag 141 Sequence Reset on Logon
        if (test_logon_sequence_reset_tag_141()) {
            result.passed_tests.push_back("Tag 141 (ResetSeqNumFlag=Y) Sequence Reset verified");
        } else {
            result.all_passed = false;
            result.failed_tests.push_back("Tag 141 Sequence Reset failed");
        }

        // Test 2: Tag 35=2 Sequence Gap & Resend Request
        if (test_sequence_gap_and_resend_request_tag_35_2()) {
            result.passed_tests.push_back("Tag 35=2 ResendRequest on MsgSeqNum gap verified");
        } else {
            result.all_passed = false;
            result.failed_tests.push_back("Tag 35=2 ResendRequest failed");
        }

        // Test 3: Tag 35=4 Sequence Reset Gap Fill (Tag 123=Y)
        if (test_sequence_reset_gap_fill_tag_35_4()) {
            result.passed_tests.push_back("Tag 35=4 SequenceReset with GapFillFlag=Y verified");
        } else {
            result.all_passed = false;
            result.failed_tests.push_back("Tag 35=4 SequenceReset GapFill failed");
        }

        // Test 4: Tag 35=G Cancel/Replace and Tag 35=9 Cancel Reject
        if (test_cancel_replace_and_reject_tags_35_g_35_9()) {
            result.passed_tests.push_back("Tags 35=G and 35=9 State Machine transitions verified");
        } else {
            result.all_passed = false;
            result.failed_tests.push_back("Tags 35=G and 35=9 State Machine transitions failed");
        }

        return result;
    }

    static bool test_logon_sequence_reset_tag_141() {
        FixSession session(FixSessionConfig{"CLIENT_A", "EXCHANGE_B", "FIX.4.4", 30, 50, 100});
        // Generate Logon with ResetSeqNumFlag=Y
        FixMessage logon = session.build_logon(true); // reset_seq_num = true

        auto tag_141 = logon.get_string(tags::ResetSeqNumFlag);
        if (!tag_141.has_value() || tag_141.value() != "Y") {
            return false;
        }

        // Outbound sequence number must be reset to 1
        uint64_t seq = logon.get_int(tags::MsgSeqNum).value_or(0);
        return (seq == 1);
    }

    static bool test_sequence_gap_and_resend_request_tag_35_2() {
        FixSession session(FixSessionConfig{"CLIENT_A", "EXCHANGE_B", "FIX.4.4", 30, 1, 1});
        // Inbound message with sequence gap: expected 1, but received 4
        // The session must generate Tag 35=2 ResendRequest with BeginSeqNo(Tag 7)=1 and EndSeqNo(Tag 16)=0
        FixMessage incoming;
        incoming.set_string(tags::BeginString, "FIX.4.4");
        incoming.set_string(tags::MsgType, "0"); // Heartbeat
        incoming.set_string(tags::SenderCompID, "EXCHANGE_B");
        incoming.set_string(tags::TargetCompID, "CLIENT_A");
        incoming.set_int(tags::MsgSeqNum, 4); // Gap: expected 1, received 4

        FixMessage response = session.handle_incoming(incoming);
        auto resp_type = response.msg_type();
        if (resp_type != "2") { // Tag 35=2 ResendRequest
            return false;
        }

        int begin_seq = response.get_int(tags::BeginSeqNo).value_or(0);
        int end_seq   = response.get_int(tags::EndSeqNo).value_or(-1);
        return (begin_seq == 1 && end_seq == 0);
    }

    static bool test_sequence_reset_gap_fill_tag_35_4() {
        FixSession session(FixSessionConfig{"CLIENT_A", "EXCHANGE_B", "FIX.4.4", 30, 1, 1});

        // Exchange responds with Tag 35=4 SequenceReset, Tag 123 GapFillFlag=Y, Tag 36 NewSeqNo=5
        FixMessage seq_reset;
        seq_reset.set_string(tags::BeginString, "FIX.4.4");
        seq_reset.set_string(tags::MsgType, "4"); // Sequence Reset
        seq_reset.set_string(tags::SenderCompID, "EXCHANGE_B");
        seq_reset.set_string(tags::TargetCompID, "CLIENT_A");
        seq_reset.set_int(tags::MsgSeqNum, 1);
        seq_reset.set_string(tags::GapFillFlag, "Y");
        seq_reset.set_int(tags::NewSeqNo, 5);

        session.handle_incoming(seq_reset);
        return (session.next_in_seq_num() == 5);
    }

    static bool test_cancel_replace_and_reject_tags_35_g_35_9() {
        FixBroker broker("PB_DMA_CONFORMANCE", "Goldman Sachs Electronic Trading (GSET)");
        OrderRequest req{};
        req.symbol = "AAPL";
        req.side = Side::BUY;
        req.type = OrderType::LIMIT;
        req.quantity = 1000.0;
        req.limit_price = 225.50;

        OrderExecution initial_exec = broker.execute(req);
        if (initial_exec.status != OrderStatus::FILLED && initial_exec.status != OrderStatus::ACCEPTED) {
            return false;
        }

        std::string cl_ord_id = std::to_string(req.client_order_id);
        std::string orig_id = cl_ord_id;
        std::string new_cl_ord_id = cl_ord_id + "_R1";

        // Successful Cancel/Replace (35=G)
        OrderExecution rep_exec = broker.cancel_replace_order(orig_id, new_cl_ord_id, "AAPL", Side::BUY, 1200.0, 226.00);
        if (rep_exec.filled_quantity != 1200.0 || rep_exec.fill_price != 226.00) {
            return false;
        }

        // Reject invalid Cancel/Replace on non-existent order (35=9)
        OrderExecution rej_exec = broker.cancel_replace_order("INVALID_NON_EXISTENT", "INVALID_R2", "AAPL", Side::BUY, 500.0, 220.00);
        return (rej_exec.status == OrderStatus::REJECTED);
    }
};

} // namespace quantos::fix
