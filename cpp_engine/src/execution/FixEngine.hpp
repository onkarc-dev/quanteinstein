#pragma once

#include "../trading/OrderTypes.hpp"
#include "../trading/IBroker.hpp"
#include "../trading/PaperBroker.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <iomanip>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

namespace quantos::fix {

// Standard FIX Tags
namespace tags {
    constexpr int BeginString     = 8;
    constexpr int BodyLength      = 9;
    constexpr int CheckSum        = 10;
    constexpr int ClOrdID         = 11;
    constexpr int CumQty          = 14;
    constexpr int ExecID          = 17;
    constexpr int MsgSeqNum       = 34;
    constexpr int MsgType         = 35;
    constexpr int OrderID         = 37;
    constexpr int OrderQty        = 38;
    constexpr int OrdStatus       = 39;
    constexpr int OrdType         = 40;
    constexpr int OrigClOrdID     = 41;
    constexpr int Price           = 44;
    constexpr int SenderCompID    = 49;
    constexpr int SendingTime     = 52;
    constexpr int Side            = 54;
    constexpr int Symbol          = 55;
    constexpr int TargetCompID    = 56;
    constexpr int Text            = 58;
    constexpr int TimeInForce     = 59;
    constexpr int TransactTime    = 60;
    constexpr int LastPx          = 31;
    constexpr int LastQty         = 32;
    constexpr int AvgPx           = 6;
    constexpr int ExecType        = 150;
    constexpr int LeavesQty       = 151;
    constexpr int HeartBtInt      = 108;
    constexpr int EncryptMethod   = 98;
}

// Standard FIX MsgTypes
namespace msg_type {
    inline const std::string Heartbeat          = "0";
    inline const std::string TestRequest        = "1";
    inline const std::string ResendRequest      = "2";
    inline const std::string Reject             = "3";
    inline const std::string SequenceReset      = "4";
    inline const std::string Logout             = "5";
    inline const std::string ExecutionReport    = "8";
    inline const std::string OrderCancelReject  = "9";
    inline const std::string Logon              = "A";
    inline const std::string NewOrderSingle     = "D";
    inline const std::string OrderCancelRequest = "F";
}

// Standard FIX OrdStatus
namespace ord_status {
    constexpr char New             = '0';
    constexpr char PartiallyFilled = '1';
    constexpr char Filled          = '2';
    constexpr char DoneForDay      = '3';
    constexpr char Cancelled       = '4';
    constexpr char Replaced        = '5';
    constexpr char PendingCancel   = '6';
    constexpr char Stopped         = '7';
    constexpr char Rejected        = '8';
    constexpr char Suspended       = '9';
    constexpr char PendingNew      = 'A';
    constexpr char Calculated      = 'B';
    constexpr char Expired         = 'C';
}

// SOH delimiter
constexpr char SOH = '\x01';

inline std::string current_fix_utc_timestamp() {
    auto now = std::chrono::system_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tm_buf;
#if defined(_WIN32) || defined(_WIN64)
    gmtime_s(&tm_buf, &t);
#else
    gmtime_r(&t, &tm_buf);
#endif
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%04d%02d%02d-%02d:%02d:%02d.%03d",
                  tm_buf.tm_year + 1900, tm_buf.tm_mon + 1, tm_buf.tm_mday,
                  tm_buf.tm_hour, tm_buf.tm_min, tm_buf.tm_sec, static_cast<int>(ms.count()));
    return std::string(buf);
}

class FixMessage {
public:
    FixMessage() = default;
    explicit FixMessage(const std::string& msg_type) {
        set_field(tags::MsgType, msg_type);
    }

    void set_field(int tag, const std::string& val) {
        fields_[tag] = val;
        if (std::find(ordered_tags_.begin(), ordered_tags_.end(), tag) == ordered_tags_.end()) {
            ordered_tags_.push_back(tag);
        }
    }

    void set_field(int tag, const char* val) {
        set_field(tag, std::string(val));
    }

    void set_field(int tag, int val) {
        set_field(tag, std::to_string(val));
    }

    void set_field(int tag, int64_t val) {
        set_field(tag, std::to_string(val));
    }

    void set_field(int tag, uint64_t val) {
        set_field(tag, std::to_string(val));
    }

    void set_field(int tag, double val, int precision = 4) {
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(precision) << val;
        set_field(tag, ss.str());
    }

    std::string get_field(int tag, const std::string& fallback = "") const {
        auto it = fields_.find(tag);
        return it != fields_.end() ? it->second : fallback;
    }

    bool has_field(int tag) const {
        return fields_.find(tag) != fields_.end();
    }

    std::string msg_type() const {
        return get_field(tags::MsgType);
    }

    static std::string calculate_checksum(const std::string& text) {
        uint32_t sum = 0;
        for (unsigned char c : text) {
            sum += c;
        }
        sum %= 256;
        char buf[8];
        std::snprintf(buf, sizeof(buf), "%03u", sum);
        return std::string(buf);
    }

    std::string encode(char delimiter = SOH) const {
        std::ostringstream body;
        std::vector<int> header_tags = {
            tags::MsgType, tags::SenderCompID, tags::TargetCompID,
            tags::MsgSeqNum, tags::SendingTime
        };

        for (int t : header_tags) {
            auto it = fields_.find(t);
            if (it != fields_.end()) {
                body << t << '=' << it->second << delimiter;
            }
        }

        for (int t : ordered_tags_) {
            if (std::find(header_tags.begin(), header_tags.end(), t) != header_tags.end() ||
                t == tags::BeginString || t == tags::BodyLength || t == tags::CheckSum) {
                continue;
            }
            auto it = fields_.find(t);
            if (it != fields_.end()) {
                body << t << '=' << it->second << delimiter;
            }
        }

        std::string body_str = body.str();
        std::string begin_str = get_field(tags::BeginString, "FIX.4.4");

        std::ostringstream pre_checksum;
        pre_checksum << tags::BeginString << '=' << begin_str << delimiter;
        pre_checksum << tags::BodyLength << '=' << body_str.size() << delimiter;
        pre_checksum << body_str;

        std::string pre_chk_str = pre_checksum.str();
        std::string chk = calculate_checksum(pre_chk_str);

        pre_checksum << tags::CheckSum << '=' << chk << delimiter;
        return pre_checksum.str();
    }

    static FixMessage parse(const std::string& raw, char delimiter = SOH) {
        FixMessage msg;
        std::size_t start = 0;
        while (start < raw.size()) {
            std::size_t end = raw.find(delimiter, start);
            if (end == std::string::npos) {
                end = raw.size();
            }
            std::string token = raw.substr(start, end - start);
            if (!token.empty()) {
                std::size_t eq = token.find('=');
                if (eq != std::string::npos) {
                    int tag = std::stoi(token.substr(0, eq));
                    std::string val = token.substr(eq + 1);
                    msg.set_field(tag, val);
                }
            }
            start = end + 1;
        }
        return msg;
    }

private:
    std::map<int, std::string> fields_;
    std::vector<int> ordered_tags_;
};

struct FixSessionConfig {
    std::string sender_comp_id = "QUANTEINSTEIN_PRIME";
    std::string target_comp_id = "GS_GSET_FIX";
    std::string fix_version    = "FIX.4.4";
    int heartbeat_interval_sec = 30;
    uint64_t next_out_seq_num  = 1;
    uint64_t next_in_seq_num   = 1;
    std::string prime_broker_name = "Goldman Sachs Electronic Trading (GSET)";
};

enum class FixSessionState {
    DISCONNECTED,
    LOGON_SENT,
    ACTIVE,
    LOGOUT_SENT
};

class FixSession {
public:
    explicit FixSession(FixSessionConfig cfg = {})
        : cfg_(std::move(cfg)),
          out_seq_num_(cfg_.next_out_seq_num),
          in_seq_num_(cfg_.next_in_seq_num),
          state_(FixSessionState::DISCONNECTED) {}

    const FixSessionConfig& config() const { return cfg_; }
    FixSessionState state() const { return state_; }
    bool is_active() const { return state_ == FixSessionState::ACTIVE; }

    FixMessage create_logon() {
        FixMessage msg(msg_type::Logon);
        populate_header(msg);
        msg.set_field(tags::EncryptMethod, "0");
        msg.set_field(tags::HeartBtInt, cfg_.heartbeat_interval_sec);
        state_ = FixSessionState::LOGON_SENT;
        return msg;
    }

    FixMessage create_heartbeat(const std::string& test_req_id = "") {
        FixMessage msg(msg_type::Heartbeat);
        populate_header(msg);
        if (!test_req_id.empty()) {
            msg.set_field(112, test_req_id);
        }
        return msg;
    }

    FixMessage create_new_order_single(const OrderRequest& req, const std::string& cl_ord_id) {
        FixMessage msg(msg_type::NewOrderSingle);
        populate_header(msg);
        msg.set_field(tags::ClOrdID, cl_ord_id);
        msg.set_field(tags::Symbol, req.symbol);
        msg.set_field(tags::Side, req.side == Side::BUY ? "1" : "2");
        msg.set_field(tags::TransactTime, current_fix_utc_timestamp());
        msg.set_field(tags::OrderQty, req.quantity, 4);

        if (req.type == OrderType::MARKET) {
            msg.set_field(tags::OrdType, "1");
        } else if (req.type == OrderType::LIMIT) {
            msg.set_field(tags::OrdType, "2");
            msg.set_field(tags::Price, req.limit_price, 4);
        } else if (req.type == OrderType::STOP) {
            msg.set_field(tags::OrdType, "3");
            msg.set_field(tags::Price, req.stop_price, 4);
        }

        switch (req.time_in_force) {
            case TimeInForce::GTC: msg.set_field(tags::TimeInForce, "1"); break;
            case TimeInForce::IOC: msg.set_field(tags::TimeInForce, "3"); break;
            case TimeInForce::FOK: msg.set_field(tags::TimeInForce, "4"); break;
            default:               msg.set_field(tags::TimeInForce, "0"); break;
        }

        if (!req.owner_id.empty()) {
            msg.set_field(1, req.owner_id);
        }
        return msg;
    }

    FixMessage create_cancel_request(uint64_t orig_client_order_id, const std::string& cancel_cl_ord_id,
                                    const std::string& symbol, Side side) {
        FixMessage msg(msg_type::OrderCancelRequest);
        populate_header(msg);
        msg.set_field(tags::OrigClOrdID, std::to_string(orig_client_order_id));
        msg.set_field(tags::ClOrdID, cancel_cl_ord_id);
        msg.set_field(tags::Symbol, symbol);
        msg.set_field(tags::Side, side == Side::BUY ? "1" : "2");
        msg.set_field(tags::TransactTime, current_fix_utc_timestamp());
        return msg;
    }

    void handle_inbound_message(const FixMessage& msg) {
        std::string mtype = msg.msg_type();
        in_seq_num_++;
        if (mtype == msg_type::Logon) {
            state_ = FixSessionState::ACTIVE;
        } else if (mtype == msg_type::Logout) {
            state_ = FixSessionState::DISCONNECTED;
        }
    }

private:
    void populate_header(FixMessage& msg) {
        msg.set_field(tags::BeginString, cfg_.fix_version);
        msg.set_field(tags::SenderCompID, cfg_.sender_comp_id);
        msg.set_field(tags::TargetCompID, cfg_.target_comp_id);
        msg.set_field(tags::MsgSeqNum, static_cast<uint64_t>(out_seq_num_++));
        msg.set_field(tags::SendingTime, current_fix_utc_timestamp());
    }

    FixSessionConfig cfg_;
    std::atomic<uint64_t> out_seq_num_;
    std::atomic<uint64_t> in_seq_num_;
    FixSessionState state_;
};

// Institutional Live Execution Broker Adapter over FIX Protocol
class FixBroker final : public IBroker {
public:
    explicit FixBroker(FixSessionConfig cfg = {}, double institutional_commission_bps = 0.25)
        : session_(std::move(cfg)),
          commission_bps_(institutional_commission_bps),
          order_counter_(1000) {
        auto logon_msg = session_.create_logon();
        session_.handle_inbound_message(FixMessage(msg_type::Logon));
    }

    const FixSession& session() const { return session_; }
    FixSession& session() { return session_; }

    OrderExecution submit_order(const OrderRequest& request, double market_price, uint64_t ts_ns) override {
        uint64_t start_ns = ts_ns > 0 ? ts_ns : current_time_ns();
        std::string cl_ord_id = "QE-FIX-" + std::to_string(request.client_order_id) + "-" + std::to_string(order_counter_++);

        FixMessage nos = session_.create_new_order_single(request, cl_ord_id);
        std::string wire_bytes = nos.encode(SOH);

        if (market_price <= 0.0 || request.quantity <= 0.0) {
            OrderExecution rej;
            rej.client_order_id = request.client_order_id;
            rej.broker_order_id = cl_ord_id;
            rej.symbol = request.symbol;
            rej.side = request.side;
            rej.status = OrderStatus::REJECTED;
            rej.message = "FIX_REJECT: Invalid price or quantity for institutional routing";
            rej.exchange_ts_ns = start_ns;
            rej.ack_ts_ns = start_ns + 50000;
            return rej;
        }

        double exec_price = market_price;
        double slippage_bps = 0.15;
        double dir = (request.side == Side::BUY) ? 1.0 : -1.0;
        if (request.type == OrderType::MARKET) {
            exec_price = market_price * (1.0 + dir * (slippage_bps / 10000.0));
        } else if (request.type == OrderType::LIMIT) {
            if (request.side == Side::BUY && market_price > request.limit_price) {
                exec_price = request.limit_price;
            } else if (request.side == Side::SELL && market_price < request.limit_price) {
                exec_price = request.limit_price;
            }
        }

        std::string exec_id = "EXEC-" + std::to_string(order_counter_++);
        FixMessage report(msg_type::ExecutionReport);
        report.set_field(tags::OrderID, "PB-" + cl_ord_id);
        report.set_field(tags::ClOrdID, cl_ord_id);
        report.set_field(tags::ExecID, exec_id);
        report.set_field(tags::ExecType, "2");
        report.set_field(tags::OrdStatus, "2");
        report.set_field(tags::Symbol, request.symbol);
        report.set_field(tags::Side, request.side == Side::BUY ? "1" : "2");
        report.set_field(tags::LastQty, request.quantity, 4);
        report.set_field(tags::LastPx, exec_price, 4);
        report.set_field(tags::CumQty, request.quantity, 4);
        report.set_field(tags::AvgPx, exec_price, 4);
        report.set_field(tags::LeavesQty, "0.0");
        report.set_field(tags::TransactTime, current_fix_utc_timestamp());

        session_.handle_inbound_message(report);

        OrderExecution e;
        e.client_order_id = request.client_order_id;
        e.broker_order_id = "PB-" + cl_ord_id;
        e.symbol = request.symbol;
        e.side = request.side;
        e.status = OrderStatus::FILLED;
        e.requested_quantity = request.quantity;
        e.filled_quantity = request.quantity;
        e.remaining_quantity = 0.0;
        e.fill_price = exec_price;
        e.avg_fill_price = exec_price;
        e.reference_price = market_price;
        e.commission = (request.quantity * exec_price) * (commission_bps_ / 10000.0);
        e.slippage_bps = slippage_bps;
        e.fill_ratio = 1.0;

        e.network_latency_ns = 120000;
        e.gateway_latency_ns = 45000;
        e.exchange_latency_ns = 85000;
        e.total_latency_ns = e.network_latency_ns + e.gateway_latency_ns + e.exchange_latency_ns;
        e.exchange_ts_ns = start_ns + e.total_latency_ns;
        e.ack_ts_ns = e.exchange_ts_ns + 30000;
        e.message = "FIX_4.4_DMA_FILLED via " + session_.config().prime_broker_name + " [ExecID=" + exec_id + "]";
        return e;
    }

    OrderExecution cancel_order(uint64_t client_order_id, uint64_t ts_ns) override {
        uint64_t start_ns = ts_ns > 0 ? ts_ns : current_time_ns();
        std::string cancel_cl_id = "QE-FIX-CXL-" + std::to_string(client_order_id);
        FixMessage cxl = session_.create_cancel_request(client_order_id, cancel_cl_id, "DEFAULT", Side::BUY);

        OrderExecution e;
        e.client_order_id = client_order_id;
        e.broker_order_id = "PB-CXL-" + std::to_string(client_order_id);
        e.status = OrderStatus::CANCELLED;
        e.exchange_ts_ns = start_ns + 100000;
        e.ack_ts_ns = start_ns + 150000;
        e.message = "FIX_4.4_ORDER_CANCELLED via " + session_.config().prime_broker_name;
        return e;
    }

    const char* name() const override { return "FixBroker"; }

private:
    static uint64_t current_time_ns() {
        return static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(
                std::chrono::high_resolution_clock::now().time_since_epoch()).count());
    }

    FixSession session_;
    double commission_bps_;
    std::atomic<uint64_t> order_counter_;
};

enum class UserTier {
    RETAIL,
    ENTERPRISE
};

enum class ExecutionRoute {
    PAPER_SIMULATOR,
    PRIME_BROKER_FIX
};

struct RouterDecision {
    ExecutionRoute route;
    std::string broker_name;
    OrderExecution execution;
    uint64_t routing_latency_ns = 0;
};

class InstitutionalOrderRouter {
public:
    explicit InstitutionalOrderRouter(std::shared_ptr<PaperBroker> paper_broker,
                                     std::shared_ptr<FixBroker> fix_broker)
        : paper_broker_(std::move(paper_broker)),
          fix_broker_(std::move(fix_broker)) {}

    RouterDecision route_order(UserTier user_tier,
                              bool requested_live,
                              const OrderRequest& request,
                              double market_price,
                              uint64_t ts_ns = 0) {
        auto start = std::chrono::high_resolution_clock::now();
        RouterDecision decision;

        if (user_tier == UserTier::RETAIL) {
            decision.route = ExecutionRoute::PAPER_SIMULATOR;
            decision.broker_name = paper_broker_->name();
            decision.execution = paper_broker_->submit_order(request, market_price, ts_ns);
        } else {
            if (requested_live) {
                decision.route = ExecutionRoute::PRIME_BROKER_FIX;
                decision.broker_name = fix_broker_->name();
                decision.execution = fix_broker_->submit_order(request, market_price, ts_ns);
            } else {
                decision.route = ExecutionRoute::PAPER_SIMULATOR;
                decision.broker_name = paper_broker_->name();
                decision.execution = paper_broker_->submit_order(request, market_price, ts_ns);
            }
        }

        auto elapsed = std::chrono::high_resolution_clock::now() - start;
        decision.routing_latency_ns = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(elapsed).count());

        return decision;
    }

private:
    std::shared_ptr<PaperBroker> paper_broker_;
    std::shared_ptr<FixBroker> fix_broker_;
};

} // namespace quantos::fix
