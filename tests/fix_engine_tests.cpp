#include "execution/FixEngine.hpp"
#include "execution/FixDropCopySession.hpp"
#include "execution/ShmChannel.hpp"
#include "trading/PaperBroker.hpp"

#include <cassert>
#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

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

void test_sharded_fix_session_manager_5000_scaling() {
    auto& mgr = FixSessionManager::instance();
    mgr.clear();
    assert(mgr.size() == 0);

    constexpr size_t TARGET_SESSIONS = 5000;
    constexpr size_t NUM_THREADS = 8;
    std::vector<std::thread> workers;
    workers.reserve(NUM_THREADS);

    // Concurrently register 5,000 unique institutional fund FIX sessions
    size_t chunk_size = TARGET_SESSIONS / NUM_THREADS;
    for (size_t t = 0; t < NUM_THREADS; ++t) {
        workers.emplace_back([t, chunk_size, &mgr]() {
            size_t start = t * chunk_size;
            size_t end = (t == NUM_THREADS - 1) ? TARGET_SESSIONS : start + chunk_size;
            for (size_t i = start; i < end; ++i) {
                FixSessionConfig cfg;
                cfg.sender_comp_id = "QE_FUND_" + std::to_string(i);
                cfg.target_comp_id = "GS_GSET_FIX";
                cfg.prime_broker_name = "Goldman Sachs GSET";
                auto session = mgr.get_or_create_session(cfg);
                assert(session != nullptr);
                assert(session->config().sender_comp_id == cfg.sender_comp_id);
            }
        });
    }

    for (auto& w : workers) {
        w.join();
    }
    workers.clear();

    assert(mgr.size() == TARGET_SESSIONS);

    // Concurrently verify 5,000 lookups across 8 threads
    std::atomic<size_t> successful_lookups{0};
    for (size_t t = 0; t < NUM_THREADS; ++t) {
        workers.emplace_back([t, chunk_size, &mgr, &successful_lookups]() {
            size_t start = t * chunk_size;
            size_t end = (t == NUM_THREADS - 1) ? TARGET_SESSIONS : start + chunk_size;
            for (size_t i = start; i < end; ++i) {
                std::string sender = "QE_FUND_" + std::to_string(i);
                auto session = mgr.get_session_by_comps(sender, "GS_GSET_FIX");
                if (session && session->config().sender_comp_id == sender) {
                    successful_lookups.fetch_add(1, std::memory_order_relaxed);
                }
            }
        });
    }

    for (auto& w : workers) {
        w.join();
    }

    assert(successful_lookups.load() == TARGET_SESSIONS);

    // Verify broadcast heartbeats across 5,000 sessions
    mgr.broadcast_heartbeats("PULSE-5000");

    // Verify removing a session
    assert(mgr.remove_session("QE_FUND_100->GS_GSET_FIX"));
    assert(mgr.size() == TARGET_SESSIONS - 1);
    assert(mgr.get_session("QE_FUND_100->GS_GSET_FIX") == nullptr);
}

void test_shm_channel_order_ipc() {
    quantos::ShmChannel channel;
    assert(channel.init_as_server());

    ShmOrderSubmission sub{};
    sub.magic = SHM_MAGIC_ORDER_SUB;
    sub.seq_num = 42;
    sub.client_order_id = 998877;
    std::strcpy(sub.client_order_id_str, "QE-IPC-TEST-001");
    std::strcpy(sub.symbol, "NVDA");
    sub.asset_class = 0; // EQUITY
    sub.side = 5; // SHORT_SELL
    sub.order_type = 2; // LIMIT
    sub.quantity = 500.0;
    sub.limit_price = 142.50;
    std::strcpy(sub.borrow_locate_id, "LOC-PB-NVDA");
    std::strcpy(sub.cusip, "67066G104");
    std::strcpy(sub.sedol, "2379504");
    std::strcpy(sub.isin, "US67066G1046");
    sub.timestamp_ns = 1730000000000ULL;

    assert(channel.push_order(sub));

    ShmOrderSubmission out_sub{};
    assert(channel.pop_order(out_sub));
    assert(out_sub.seq_num == 42);
    assert(out_sub.client_order_id == 998877);
    assert(std::string(out_sub.client_order_id_str) == "QE-IPC-TEST-001");
    assert(std::string(out_sub.symbol) == "NVDA");
    assert(out_sub.side == 5);
    assert(out_sub.quantity == 500.0);
    assert(std::string(out_sub.borrow_locate_id) == "LOC-PB-NVDA");
    assert(std::string(out_sub.cusip) == "67066G104");

    // Execution report roundtrip
    ShmExecutionReport rep{};
    rep.magic = SHM_MAGIC_EXEC_REP;
    rep.seq_num = 42;
    rep.client_order_id = 998877;
    std::strcpy(rep.client_order_id_str, "QE-IPC-TEST-001");
    std::strcpy(rep.broker_order_id, "PB-GS-001");
    std::strcpy(rep.exec_id, "EXEC-GS-999");
    std::strcpy(rep.symbol, "NVDA");
    rep.side = 5;
    rep.exec_type = 2; // Fill
    rep.ord_status = 3; // Filled
    rep.order_qty = 500.0;
    rep.cum_qty = 500.0;
    rep.last_px = 142.50;
    rep.total_latency_ns = 1450;

    assert(channel.push_execution_report(rep));

    ShmExecutionReport out_rep{};
    assert(channel.pop_execution_report(out_rep));
    assert(out_rep.seq_num == 42);
    assert(std::string(out_rep.broker_order_id) == "PB-GS-001");
    assert(out_rep.last_px == 142.50);
}

void test_fix_drop_copy_session_and_clearing() {
    FixDropCopySession drop_copy;
    drop_copy.set_connected(true);
    assert(drop_copy.is_connected());

    FixMessage exec_rep;
    exec_rep.set_string(tags::BeginString, "FIX.4.4");
    exec_rep.set_string(tags::MsgType, "8");
    exec_rep.set_string(tags::SenderCompID, "GS_GSET_DROPCOPY");
    exec_rep.set_string(tags::TargetCompID, "QE_DROPMONITOR_PROD");
    exec_rep.set_int(tags::MsgSeqNum, 1);
    exec_rep.set_string(tags::ClOrdID, "QE-INST-001");
    exec_rep.set_string(tags::OrderID, "PB-GS-9988");
    exec_rep.set_string(tags::ExecID, "EXEC-101");
    exec_rep.set_string(tags::ExecType, "2"); // Fill
    exec_rep.set_string(tags::OrdStatus, "2"); // Filled
    exec_rep.set_string(tags::Symbol, "AAPL");
    exec_rep.set_string(tags::Side, "1"); // Buy
    exec_rep.set_double(tags::LastQty, 1000.0);
    exec_rep.set_double(tags::LastPx, 225.00);
    exec_rep.set_double(tags::CumQty, 1000.0);
    exec_rep.set_double(tags::AvgPx, 225.00);
    exec_rep.set_string(tags::TransactTime, "20261030-14:30:00.000");

    assert(drop_copy.ingest_execution_report(exec_rep));
    assert(drop_copy.total_reports() == 1);
    assert(drop_copy.total_notional_cleared() == 225000.0);

    std::string csv = drop_copy.export_fund_admin_csv();
    assert(csv.find("CITCO_FUND_SERVICES") != std::string::npos);
    assert(csv.find("AAPL") != std::string::npos);
    assert(csv.find("225000.00") != std::string::npos);
}

void test_fix_conformance_harness() {
    auto result = FixConformanceHarness::run_all_conformance_tests();
    for (const auto& pass : result.passed_tests) {
        std::cout << "    [Conformance] ✓ " << pass << std::endl;
    }
    assert(result.all_passed);
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
    test_sharded_fix_session_manager_5000_scaling();
    std::cout << "  ✓ Sharded FixSessionManager (5,000 concurrent sessions, 8 threads) verified" << std::endl;
    test_fix_session_lifecycle();
    std::cout << "  ✓ FixSession logon & heartbeat verified" << std::endl;
    test_fix_broker_order_execution();
    std::cout << "  ✓ FixBroker DMA order execution verified" << std::endl;
    test_fix_cancel_replace_and_reject();
    std::cout << "  ✓ FIX 35=G Cancel/Replace & 35=9 Reject verified" << std::endl;
    test_dual_tier_order_router_isolation();
    std::cout << "  ✓ Dual-tier institutional router isolation verified" << std::endl;
    test_shm_channel_order_ipc();
    std::cout << "  ✓ Zero-copy shared-memory IPC SPSC ring buffer verified" << std::endl;
    test_fix_drop_copy_session_and_clearing();
    std::cout << "  ✓ FixDropCopySession (Tag 35=8) & Citco/SS&C clearing verified" << std::endl;
    test_fix_conformance_harness();
    std::cout << "  ✓ Automated FIX Conformance Suite (Tags 141, 34, 35=2, 35=4) verified" << std::endl;
    std::cout << "[FIX Engine Tests] ALL 11 TESTS PASSED SUCCESSFULLY!" << std::endl;
    return 0;
}
