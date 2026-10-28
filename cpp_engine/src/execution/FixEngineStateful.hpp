#pragma once

#include "FixEngine.hpp"
#include <string>
#include <unordered_map>
#include <mutex>

namespace quantos::fix {

namespace tags {
    constexpr int OrigClOrdID      = 41;
    constexpr int CxlRejResponseTo = 434;
    constexpr int CxlRejReason     = 102;
    constexpr int OrdRejReason     = 103;
}

namespace msg_type {
    inline const std::string OrderCancelReplace = "G";
}

struct ManagedOrderState {
    std::string cl_ord_id;
    std::string orig_cl_ord_id;
    std::string broker_order_id;
    std::string symbol;
    Side side;
    double original_qty;
    double current_qty;
    double filled_qty;
    double price;
    char ord_status; // '0'=New, '1'=PartiallyFilled, '2'=Filled, '4'=Cancelled, '5'=Replaced
    uint64_t created_at_ns;
    uint64_t updated_at_ns;
};

class StatefulFixBroker {
public:
    explicit StatefulFixBroker(FixSessionConfig cfg = {})
        : session_(std::move(cfg)), order_seq_(50000) {}

    // Tag 35=G: Order Cancel / Replace Request
    FixMessage create_cancel_replace(
        const std::string& orig_cl_ord_id,
        const std::string& new_cl_ord_id,
        const std::string& symbol,
        Side side,
        double new_qty,
        double new_price)
    {
        FixMessage msg(msg_type::OrderCancelReplace);
        msg.set_field(tags::OrigClOrdID, orig_cl_ord_id);
        msg.set_field(tags::ClOrdID, new_cl_ord_id);
        msg.set_field(tags::Symbol, symbol);
        msg.set_field(tags::Side, side == Side::BUY ? "1" : "2");
        msg.set_field(tags::OrderQty, new_qty, 4);
        msg.set_field(tags::OrdType, "2"); // Limit
        msg.set_field(tags::Price, new_price, 4);
        msg.set_field(tags::TransactTime, current_fix_utc_timestamp());
        return msg;
    }

    // Tag 35=9: Order Cancel Reject Message
    FixMessage create_cancel_reject(
        const std::string& orig_cl_ord_id,
        const std::string& cl_ord_id,
        char cxl_rej_response_to, // '1'=Order Cancel, '2'=Order Cancel/Replace
        int rej_reason,
        const std::string& reason_text)
    {
        FixMessage msg(msg_type::OrderCancelReject);
        msg.set_field(tags::OrigClOrdID, orig_cl_ord_id);
        msg.set_field(tags::ClOrdID, cl_ord_id);
        msg.set_field(tags::OrderID, "PB-ORD-REJ");
        msg.set_field(tags::OrdStatus, "8"); // Rejected
        msg.set_field(tags::CxlRejResponseTo, std::string(1, cxl_rej_response_to));
        msg.set_field(tags::CxlRejReason, rej_reason);
        msg.set_field(tags::Text, reason_text);
        return msg;
    }

    // Handles inbound execution updates and transitions order lifecycle
    bool process_execution_report(const FixMessage& report) {
        std::lock_guard<std::mutex> lock(state_mutex_);
        std::string cl_id = report.get_field(tags::ClOrdID);
        std::string status_str = report.get_field(tags::OrdStatus);
        if (status_str.empty()) return false;

        char status = status_str[0];
        auto it = active_orders_.find(cl_id);
        if (it != active_orders_.end()) {
            it->second.ord_status = status;
            it->second.filled_qty = std::stod(report.get_field(tags::CumQty, "0.0"));
            return true;
        }
        return false;
    }

private:
    FixSession session_;
    std::atomic<uint64_t> order_seq_;
    std::mutex state_mutex_;
    std::unordered_map<std::string, ManagedOrderState> active_orders_;
};

} // namespace quantos::fix
