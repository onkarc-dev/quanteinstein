#include "execution/FixEngine.hpp"
#include "trading/PaperBroker.hpp"

#include <cassert>
#include <cmath>
#include <iostream>
#include <memory>
#include <string>

using namespace quantos::fix;

namespace {

void test_fix_message_encode_and_checksum() {
    FixMessage msg(msg_type::NewOrderSingle);
    msg.set_field(tags::SenderCompID, "QE_CLIENT");
    msg.set_field(tags::TargetCompID, "PRIME_BROKER_X");
    msg.set_field(tags::MsgSeqNum, 1);
    msg.set_field(tags::SendingTime, "20261028-12:00:00.000");
    msg.set_field(tags::ClOrdID, "ORD-999");
    msg.set_field(tags::Symbol, "BTCUSDT");
    msg.set_field(tags::Side, "1"); // BUY
    msg.set_field(tags::OrderQty, 2.5, 4);
    msg.set_field(tags::OrdType, "1"); // Market

    std::string encoded = msg.encode('|');

    // Verify header tags
    assert(encoded.find("8=FIX.4.4|") == 0);
    assert(encoded.find("9=") != std::string::npos);
    assert(encoded.find("35=D|") != std::string::npos);
    assert(encoded.find("11=ORD-999|") != std::string::npos);
    assert(encoded.find("55=BTCUSDT|") != std::string::npos);
    assert(encoded.find("54=1|") != std::string::npos);
    assert(encoded.find("10=") != std::string::npos);

    // Verify Checksum length is 3 digits
    std::size_t chk_pos = encoded.rfind("10=");
    assert(chk_pos != std::string::npos);
    std::string chk_val = encoded.substr(chk_pos + 3, 3);
    assert(chk_val.size() == 3);
}

void test_fix_message_parse() {
    std::string raw = "8=FIX.4.4|9=75|35=D|49=QE_CLIENT|56=PB_X|34=1|52=20261028-12:00:00.000|11=ORD-100|55=ETHUSDT|54=2|38=10.0000|40=2|44=3000.5000|10=182|";
    FixMessage parsed = FixMessage::parse(raw, '|');

    assert(parsed.get_field(tags::BeginString) == "FIX.4.4");
    assert(parsed.msg_type() == msg_type::NewOrderSingle);
    assert(parsed.get_field(tags::ClOrdID) == "ORD-100");
    assert(parsed.get_field(tags::Symbol) == "ETHUSDT");
    assert(parsed.get_field(tags::Side) == "2");
    assert(parsed.get_field(tags::OrdType) == "2");
    assert(parsed.get_field(tags::Price) == "3000.5000");
    assert(parsed.get_field(tags::CheckSum) == "182");
}

void test_fix_session_lifecycle() {
    FixSessionConfig cfg;
    cfg.sender_comp_id = "QE_INSTITUTIONAL";
    cfg.target_comp_id = "B2C2_PRIME";
    FixSession session(cfg);

    assert(!session.is_active());
    FixMessage logon = session.create_logon();
    assert(logon.msg_type() == msg_type::Logon);
    assert(session.state() == FixSessionState::LOGON_SENT);

    // Simulate incoming logon response from prime broker
    FixMessage pb_logon(msg_type::Logon);
    session.handle_inbound_message(pb_logon);
    assert(session.is_active());

    // Generate heartbeat
    FixMessage hb = session.create_heartbeat("TEST-PING");
    assert(hb.msg_type() == msg_type::Heartbeat);
    assert(hb.get_field(112) == "TEST-PING");
}

void test_fix_broker_order_execution() {
    FixSessionConfig cfg;
    cfg.sender_comp_id = "QE_INSTITUTIONAL";
    cfg.target_comp_id = "GS_GSET_FIX";
    cfg.prime_broker_name = "Goldman Sachs Electronic Trading (GSET)";

    FixBroker broker(cfg, 0.20); // 0.20 bps institutional commission
    assert(broker.session().is_active());

    OrderRequest req;
    req.client_order_id = 7771;
    req.symbol = "BTCUSDT";
    req.side = Side::BUY;
    req.type = OrderType::MARKET;
    req.quantity = 1.25;
    req.owner_id = "TIER1_HEDGE_FUND_ALPHA";

    OrderExecution exec = broker.submit_order(req, 65000.0, 1'000'000);

    assert(exec.client_order_id == 7771);
    assert(exec.status == OrderStatus::FILLED);
    assert(exec.filled_quantity == 1.25);
    assert(exec.fill_price > 0.0);
    assert(exec.broker_order_id.rfind("PB-QE-FIX-7771-", 0) == 0);
    assert(exec.network_latency_ns > 0);
    assert(exec.total_latency_ns > 0);
    assert(exec.message.find("FIX_4.4_DMA_FILLED via Goldman Sachs") != std::string::npos);

    // Test cancel
    OrderExecution cxl = broker.cancel_order(7771, 2'000'000);
    assert(cxl.status == OrderStatus::CANCELLED);
    assert(cxl.message.find("FIX_4.4_ORDER_CANCELLED") != std::string::npos);
}

void test_fix_cancel_replace_and_reject() {
    FixSessionConfig cfg;
    cfg.sender_comp_id = "QE_INSTITUTIONAL";
    cfg.target_comp_id = "GS_GSET_FIX";
    cfg.prime_broker_name = "Goldman Sachs Electronic Trading (GSET)";
    FixBroker broker(cfg, 0.20);

    // 1. Test Order Cancel / Replace (Tag 35=G)
    OrderExecution rep = broker.replace_order("QE-FIX-7771-1000", 2.50, 64800.0, "BTCUSDT", Side::BUY, 3'000'000);
    assert(rep.status == OrderStatus::NEW);
    assert(rep.requested_quantity == 2.50);
    assert(rep.fill_price == 64800.0);
    assert(rep.message.find("FIX_35=G_ORDER_REPLACED") != std::string::npos);

    // 2. Test Order Cancel Reject (Tag 35=9) on invalid quantity
    OrderExecution rej = broker.replace_order("QE-FIX-7771-1000", -1.0, 64800.0, "BTCUSDT", Side::BUY, 4'000'000);
    assert(rej.status == OrderStatus::REJECTED);
    assert(rej.message.find("FIX_35=9_CANCEL_REJECT") != std::string::npos);
    assert(rej.message.find("Invalid replacement price or quantity") != std::string::npos);
}

void test_dual_tier_order_router_isolation() {
    auto paper = std::make_shared<PaperBroker>();
    FixSessionConfig cfg;
    cfg.prime_broker_name = "Wintermute FIX DMA";
    auto fix = std::make_shared<FixBroker>(cfg);

    InstitutionalOrderRouter router(paper, fix);

    OrderRequest req;
    req.client_order_id = 8801;
    req.symbol = "SOLUSDT";
    req.side = Side::BUY;
    req.type = OrderType::MARKET;
    req.quantity = 10.0;

    // Test Case 1: Retail user requesting LIVE execution MUST be forced to PAPER SIMULATOR
    RouterDecision retail_decision = router.route_order(
        UserTier::RETAIL,
        true, // Retail user trying to request live
        req,
        150.0,
        1'000'000
    );
    assert(retail_decision.route == ExecutionRoute::PAPER_SIMULATOR);
    assert(retail_decision.broker_name == "PaperBroker");

    // Test Case 2: Enterprise user with live=false routes to PAPER SIMULATOR
    RouterDecision ent_sim_decision = router.route_order(
        UserTier::ENTERPRISE,
        false,
        req,
        150.0,
        2'000'000
    );
    assert(ent_sim_decision.route == ExecutionRoute::PAPER_SIMULATOR);
    assert(ent_sim_decision.broker_name == "PaperBroker");

    // Test Case 3: Enterprise user with live=true routes directly to PRIME BROKER FIX
    RouterDecision ent_live_decision = router.route_order(
        UserTier::ENTERPRISE,
        true,
        req,
        150.0,
        3'000'000
    );
    assert(ent_live_decision.route == ExecutionRoute::PRIME_BROKER_FIX);
    assert(ent_live_decision.broker_name == "FixBroker");
    assert(ent_live_decision.execution.status == OrderStatus::FILLED);
    assert(ent_live_decision.execution.broker_order_id.find("PB-QE-FIX-") != std::string::npos);
    assert(ent_live_decision.routing_latency_ns > 0);
}

void test_zero_alloc_fix_pool_and_direct_wire_encode() {
    auto& pool = FixMessagePool::instance();
    FixMessage* msg1 = pool.acquire();
    assert(msg1 != nullptr);
    msg1->set_field(tags::MsgType, msg_type::NewOrderSingle);
    msg1->set_field(tags::ClOrdID, "POOL-101");
    msg1->set_field(tags::Symbol, "BTCUSDT");
    msg1->set_field(tags::Side, "1");
    msg1->set_field(tags::OrderQty, 5.0, 4);
    msg1->set_field(tags::Price, 68000.5, 2);

    char wire_buf[512];
    size_t wire_len = msg1->encode_to(wire_buf, sizeof(wire_buf), '|');
    assert(wire_len > 0);
    std::string_view sv(wire_buf, wire_len);
    assert(sv.find("8=FIX.4.4|") == 0);
    assert(sv.find("35=D|") != std::string_view::npos);
    assert(sv.find("11=POOL-101|") != std::string_view::npos);
    assert(sv.find("55=BTCUSDT|") != std::string_view::npos);
    assert(sv.find("38=5.0000|") != std::string_view::npos);
    assert(sv.find("44=68000.50|") != std::string_view::npos);
    assert(sv.find("10=") != std::string_view::npos);

    pool.release(msg1);

    // Verify RAII PooledFixMessage
    {
        PooledFixMessage pmsg(msg_type::OrderCancelRequest);
        assert(pmsg->msg_type_sv() == "F");
        pmsg->set_field(tags::ClOrdID, "POOL-CXL");
        assert(pmsg->get_field_sv(tags::ClOrdID) == "POOL-CXL");
    }
}

} // namespace

int main() {
    std::cout << "[FIX Engine Tests] Starting C++ institutional tests..." << std::endl;
    test_fix_message_encode_and_checksum();
    std::cout << "  ✓ FixMessage encode & checksum verified" << std::endl;
    test_fix_message_parse();
    std::cout << "  ✓ FixMessage parse verified" << std::endl;
    test_zero_alloc_fix_pool_and_direct_wire_encode();
    std::cout << "  ✓ Zero-alloc FixMessagePool & direct wire encoder verified" << std::endl;
    test_fix_session_lifecycle();
    std::cout << "  ✓ FixSession logon & heartbeat verified" << std::endl;
    test_fix_broker_order_execution();
    std::cout << "  ✓ FixBroker DMA order execution verified" << std::endl;
    test_fix_cancel_replace_and_reject();
    std::cout << "  ✓ FIX 35=G Cancel/Replace & 35=9 Reject verified" << std::endl;
    test_dual_tier_order_router_isolation();
    std::cout << "  ✓ Dual-tier institutional router isolation verified" << std::endl;
    std::cout << "[FIX Engine Tests] ALL 7 TESTS PASSED SUCCESSFULLY!" << std::endl;
    return 0;
}
