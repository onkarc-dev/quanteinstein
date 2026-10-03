#include "../connectors/BinanceClient.h"
#include "../PrismConfigLoader.hpp"
#include "../dashboard/DashboardWriter.hpp"
#include "../engine_shared.hpp"
#include "../json_trade_parser.hpp"
#include "../prism_live_engine.hpp"
#include "../storage/EventStore.hpp"
#include "../time_utils.hpp"
#include "../trading/PaperBroker.hpp"
#include "../trading/Portfolio.hpp"
#include "../trading/PositionSizer.hpp"
#include "../trading/RiskManager.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cctype>
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <ctime>

RawTradeQueue raw_trade_queue;
TradeQueue trade_queue;
std::atomic<bool> running{true};

namespace {
void signal_handler(int) { running.store(false, std::memory_order_relaxed); }

void update_max(std::atomic<uint64_t>& target, uint64_t value) {
    uint64_t prev = target.load(std::memory_order_relaxed);
    while (value > prev && !target.compare_exchange_weak(prev, value, std::memory_order_relaxed)) {}
}

class LatencyStats {
public:
    void observe(uint64_t value_ns) noexcept {
        if (value_ns == 0) return;
        current_ns_.store(value_ns, std::memory_order_relaxed);
        total_ns_.fetch_add(value_ns, std::memory_order_relaxed);
        count_.fetch_add(1, std::memory_order_relaxed);
        update_max(max_ns_, value_ns);
        const uint64_t index = write_index_.fetch_add(1, std::memory_order_relaxed);
        samples_[index & (kWindowSize - 1)].store(value_ns, std::memory_order_relaxed);
    }
    uint64_t current_ns() const noexcept { return current_ns_.load(std::memory_order_relaxed); }
    uint64_t max_ns() const noexcept { return max_ns_.load(std::memory_order_relaxed); }
    uint64_t avg_ns() const noexcept {
        const uint64_t c = count_.load(std::memory_order_relaxed);
        return c == 0 ? 0 : total_ns_.load(std::memory_order_relaxed) / c;
    }
    uint64_t percentile_ns(double pct) const {
        const uint64_t c = count_.load(std::memory_order_relaxed);
        const size_t n = static_cast<size_t>(std::min<uint64_t>(c, kWindowSize));
        if (n == 0) return 0;
        std::vector<uint64_t> values; values.reserve(n);
        for (size_t i = 0; i < n; ++i) {
            uint64_t v = samples_[i].load(std::memory_order_relaxed);
            if (v > 0) values.push_back(v);
        }
        if (values.empty()) return 0;
        std::sort(values.begin(), values.end());
        pct = std::max(0.0, std::min(100.0, pct));
        return values[static_cast<size_t>((pct / 100.0) * static_cast<double>(values.size() - 1))];
    }
private:
    static constexpr size_t kWindowSize = 4096;
    std::array<std::atomic<uint64_t>, kWindowSize> samples_{};
    std::atomic<uint64_t> write_index_{0}, count_{0}, total_ns_{0}, current_ns_{0}, max_ns_{0};
};

struct Args {
    std::string symbol = "btcusdt";
    int bar_seconds = 10;
    int snapshot_ms = 1000;
    bool force_demo_signal = false;
    bool managed_run = false;
    std::string config_path;
    std::string output_dir;
};

Args parse_args(int argc, char** argv) {
    Args a;
    if (argc >= 2 && argv[1][0] != '-') a.symbol = argv[1];
    for (int i = 1; i < argc; ++i) {
        std::string x = argv[i];
        if (x == "--symbol" && i + 1 < argc) a.symbol = argv[++i];
        else if (x == "--bar-seconds" && i + 1 < argc) a.bar_seconds = std::max(1, std::stoi(argv[++i]));
        else if (x == "--snapshot-ms" && i + 1 < argc) a.snapshot_ms = std::max(100, std::stoi(argv[++i]));
        else if (x == "--config" && i + 1 < argc) a.config_path = argv[++i];
        else if (x == "--output-dir" && i + 1 < argc) a.output_dir = argv[++i];
        else if (x == "--managed-run") a.managed_run = true;
        else if (x == "--force-demo-signal") a.force_demo_signal = true;
    }
    return a;
}


std::string wall_clock_time() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t tt = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &tt);
#else
    localtime_r(&tt, &tm);
#endif
    std::ostringstream ss;
    ss << std::put_time(&tm, "%H:%M:%S");
    return ss.str();
}

void push_event(DashboardTradeState& state, const std::string& type, const std::string& message) {
    state.event_log.push_back(DashboardEventRecord{wall_clock_time(), type, message});
    if (state.event_log.size() > 300) state.event_log.erase(state.event_log.begin(), state.event_log.begin() + (state.event_log.size() - 300));
}

void recompute_analytics(DashboardTradeState& state) {
    state.win_rate = state.total_trades ? (100.0 * static_cast<double>(state.wins) / static_cast<double>(state.total_trades)) : 0.0;
    state.expectancy_r = state.avg_r;
    double gross_win_r = 0.0, gross_loss_r = 0.0;
    bool first = true;
    for (const auto& tr : state.trade_history) {
        if (first) { state.best_r = state.worst_r = tr.r; first = false; }
        state.best_r = std::max(state.best_r, tr.r);
        state.worst_r = std::min(state.worst_r, tr.r);
        if (tr.r > 0.0) gross_win_r += tr.r;
        if (tr.r < 0.0) gross_loss_r += std::abs(tr.r);
    }
    state.profit_factor = gross_loss_r > 1e-9 ? gross_win_r / gross_loss_r : (gross_win_r > 0.0 ? 999.0 : 0.0);
}

void push_equity(DashboardTradeState& state, double equity_value) {
    state.equity_curve.push_back(equity_value);
    if (state.equity_curve.size() > 500) state.equity_curve.erase(state.equity_curve.begin(), state.equity_curve.begin() + (state.equity_curve.size() - 500));
}

bool submit_paper_order(const std::string& symbol, const std::string& reason, double entry, double stop,
                        double setup_score, uint64_t ts_ns, uint64_t& next_order_id, uint64_t& signals,
                        const StrategyRulesConfig& strategy_config,
                        RiskManager& risk, Portfolio& portfolio, PaperBroker& broker, EventStore& store,
                        DashboardTradeState& state) {
    ++signals;
    push_event(state, "PRISM_SIGNAL", "BUY signal " + symbol + " entry=" + std::to_string(entry) + " stop=" + std::to_string(stop));
    const double risk_per_unit = std::max(0.01, std::abs(entry - stop));
    const double t1 = entry + strategy_config.targets.target1_R * risk_per_unit;
    const double t2 = entry + strategy_config.targets.target2_R * risk_per_unit;
    store.signal(symbol, reason, entry, stop, t1, t2);

    std::cout << "PRISM_OUTPUT signal=BUY symbol=" << symbol
              << " entry=" << entry
              << " stop=" << stop
              << " target1=" << t1
              << " target2=" << t2
              << " setup_score=" << setup_score
              << " reason=" << reason << "\n";

    const double qty = PositionSizer::fixed_fractional(
        risk.equity(), risk.config().max_risk_per_trade_pct, entry, stop, risk.config().max_symbol_notional);

    OrderRequest req;
    req.client_order_id = next_order_id++;
    req.symbol = symbol;
    req.side = Side::BUY;
    req.quantity = qty;
    req.strategy_tag = reason;

    const auto decision = risk.validate(req, entry, portfolio.positions());
    store.risk_decision(symbol, decision.approved, decision.reason, decision.notional);
    if (!decision.approved) {
        state.last_action = "RISK_REJECT";
        state.last_symbol = symbol;
        state.last_side = "BUY";
        state.last_reason = decision.reason;
        std::cout << "RISK_REJECT symbol=" << symbol << " reason=" << decision.reason
                  << " notional=" << decision.notional << "\n";
        return false;
    }

    const auto exec = broker.submit_order(req, entry, ts_ns);
    portfolio.apply_fill(exec);
    if (portfolio.positions().count(symbol)) {
        store.position_snapshot(symbol, portfolio.positions().at(symbol).quantity,
                                portfolio.positions().at(symbol).avg_price,
                                portfolio.positions().at(symbol).realized_pnl,
                                portfolio.positions().at(symbol).unrealized_pnl);
    }

    state.open_trade = exec.status == OrderStatus::FILLED;
    state.open_symbol = symbol;
    state.open_side = "BUY";
    state.open_qty = exec.filled_quantity;
    state.open_entry = exec.fill_price;
    state.open_stop = stop;
    state.open_target1 = t1;
    state.open_target2 = t2;
    state.open_current_r = 0.0;
    state.open_setup_score = setup_score;
    state.open_reason = reason;
    state.last_action = "PAPER_BUY_FILL";
    state.last_result = "OPEN";
    state.last_symbol = symbol;
    state.last_side = "BUY";
    state.last_entry = exec.fill_price;
    state.last_exit = 0.0;
    state.last_stop = stop;
    state.last_target1 = t1;
    state.last_target2 = t2;
    state.last_r = 0.0;
    state.last_setup_score = setup_score;
    state.last_reason = reason;
    push_event(state, "PAPER_BUY_FILL", symbol + " qty=" + std::to_string(exec.filled_quantity) + " fill=" + std::to_string(exec.fill_price));

    std::cout << "PAPER_BUY_FILL symbol=" << symbol
              << " qty=" << exec.filled_quantity
              << " fill=" << exec.fill_price
              << " stop=" << stop
              << " target1=" << t1
              << " target2=" << t2
              << " setup_score=" << setup_score
              << " reason=" << reason << "\n";
    return state.open_trade;
}

void close_paper_trade(const std::string& reason, double exit_price, uint64_t ts_ns,
                       uint64_t& next_order_id, Portfolio& portfolio, PaperBroker& broker,
                       EventStore& store, DashboardTradeState& state) {
    if (!state.open_trade || state.open_qty <= 0.0) return;
    const double risk_per_unit = std::max(0.01, std::abs(state.open_entry - state.open_stop));
    const double r_multiple = (exit_price - state.open_entry) / risk_per_unit;
    const double estimated_pnl = (exit_price - state.open_entry) * state.open_qty;
    constexpr double kBreakevenR = 0.01;

    OrderRequest req;
    req.client_order_id = next_order_id++;
    req.symbol = state.open_symbol;
    req.side = Side::SELL;
    req.quantity = state.open_qty;
    req.strategy_tag = reason;

    const auto exec = broker.submit_order(req, exit_price, ts_ns);
    portfolio.apply_fill(exec);

    state.total_trades++;
    state.gross_r += r_multiple;
    state.avg_r = state.total_trades ? state.gross_r / static_cast<double>(state.total_trades) : 0.0;
    if (r_multiple > kBreakevenR) {
        state.wins++;
        state.current_consecutive_wins++;
        state.current_consecutive_losses = 0;
        state.max_consecutive_wins = std::max(state.max_consecutive_wins, state.current_consecutive_wins);
    } else if (r_multiple < -kBreakevenR) {
        state.losses++;
        state.current_consecutive_losses++;
        state.current_consecutive_wins = 0;
        state.max_consecutive_losses = std::max(state.max_consecutive_losses, state.current_consecutive_losses);
    } else {
        state.breakevens++;
        state.current_consecutive_wins = 0;
        state.current_consecutive_losses = 0;
    }

    state.last_action = "PAPER_SELL_FILL";
    state.last_result = r_multiple > kBreakevenR ? "WIN" : (r_multiple < -kBreakevenR ? "LOSS" : "BREAKEVEN");
    state.last_symbol = state.open_symbol;
    state.last_side = "SELL";
    state.last_entry = state.open_entry;
    state.last_exit = exec.fill_price;
    state.last_stop = state.open_stop;
    state.last_target1 = state.open_target1;
    state.last_target2 = state.open_target2;
    state.last_r = r_multiple;
    state.last_setup_score = state.open_setup_score;
    state.last_reason = reason;

    DashboardTradeRecord rec;
    rec.id = state.total_trades;
    rec.time = wall_clock_time();
    rec.symbol = state.last_symbol;
    rec.side = "BUY";
    rec.qty = req.quantity;
    rec.entry = state.last_entry;
    rec.exit = state.last_exit;
    rec.stop = state.last_stop;
    rec.target1 = state.last_target1;
    rec.target2 = state.last_target2;
    rec.result = state.last_result;
    rec.r = state.last_r;
    rec.pnl = estimated_pnl;
    rec.reason = reason;
    state.trade_history.push_back(rec);
    if (state.trade_history.size() > 1000) state.trade_history.erase(state.trade_history.begin(), state.trade_history.begin() + (state.trade_history.size() - 1000));
    recompute_analytics(state);
    push_equity(state, 100000.0 + portfolio.total_realized_pnl() + portfolio.total_unrealized_pnl());
    push_event(state, "TRADE_CLOSED", state.last_symbol + " " + state.last_result + " R=" + std::to_string(state.last_r) + " pnl=" + std::to_string(estimated_pnl));

    std::ostringstream ss;
    ss << "{\"symbol\":\"" << state.last_symbol << "\",\"result\":\"" << state.last_result
       << "\",\"entry\":" << state.last_entry << ",\"exit\":" << state.last_exit
       << ",\"stop\":" << state.last_stop << ",\"target1\":" << state.last_target1
       << ",\"target2\":" << state.last_target2 << ",\"R_multiple\":" << state.last_r
       << ",\"exit_reason\":\"" << reason << "\"}";
    store.append("TRADE_CLOSED", ss.str());

    std::cout << "PAPER_SELL_FILL symbol=" << state.last_symbol
              << " result=" << state.last_result
              << " qty=" << req.quantity
              << " entry=" << state.last_entry
              << " exit=" << state.last_exit
              << " stop=" << state.last_stop
              << " target1=" << state.last_target1
              << " target2=" << state.last_target2
              << " R_multiple=" << state.last_r
              << " total_trades=" << state.total_trades
              << " wins=" << state.wins
              << " losses=" << state.losses
              << " gross_R=" << state.gross_r
              << " avg_R=" << state.avg_r
              << " exit_reason=" << reason << "\n";

    state.open_trade = false;
    state.open_qty = 0.0;
    state.open_current_r = 0.0;
}
} // namespace

int main(int argc, char** argv) {
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    Args args = parse_args(argc, argv);
    if (!args.managed_run) {
        std::cout << "QuantOS live paper engine is in STANDBY. Start it from the web app: Paper Trading -> Start Live Paper Trading.\n"
                  << "Direct manual runs are disabled to prevent unintended live WebSocket sessions.\n"
                  << "Advanced/manual override: pass --managed-run --config <live_strategy_config.json>.\n";
        return 0;
    }
    PrismConfig prism_config;
    if (!args.config_path.empty()) {
        try {
            prism_config = prism_config_loader::load(args.config_path);
            if (!prism_config.symbols.empty()) args.symbol = prism_config.symbols.front();
            args.bar_seconds = std::max(1, prism_config.bar_seconds);
        } catch (const std::exception& e) {
            std::cerr << "CONFIG_LOAD_ERROR path=" << args.config_path << " error=" << e.what() << "\n";
        }
    } else {
        prism_config.bar_seconds = args.bar_seconds;
        prism_config.symbols = {args.symbol};
    }
    std::transform(args.symbol.begin(), args.symbol.end(), args.symbol.begin(), [](unsigned char c){ return static_cast<char>(std::tolower(c)); });

    std::string out_dir = args.output_dir;
    if (out_dir.empty()) out_dir = prism_config.output_dir;
    if (out_dir.empty()) out_dir = "outputs/prismflow_cpp_heavy";
    std::filesystem::create_directories(out_dir);

    EventStore store(out_dir + "/events.jsonl");
    RiskConfig live_risk_cfg{};
    live_risk_cfg.max_risk_per_trade_pct = std::max(0.0, prism_config.strategy.risk.risk_per_trade_pct) / 100.0;
    live_risk_cfg.max_symbol_notional = std::max(1.0, prism_config.strategy.risk.max_symbol_notional);
    live_risk_cfg.max_daily_loss = live_risk_cfg.starting_equity * std::max(0.0, prism_config.strategy.risk.max_daily_loss_pct) / 100.0;
    live_risk_cfg.max_open_positions = std::max(1, prism_config.strategy.risk.max_open_positions);
    RiskManager risk(live_risk_cfg);
    Portfolio portfolio(out_dir + "/ledger.csv");
    DashboardWriter dashboard(out_dir + "/dashboard");
    PaperBroker broker(&store, 1.0, 0.5);
    PrismLiveEngine prism(args.bar_seconds, prism_config.strategy);
    BinanceClient client(args.symbol);

    LatencyStats engine_latency;
    LatencyStats ingest_latency;
    std::atomic<uint64_t> processed{0}, parsed{0}, parse_dropped{0};
    std::atomic<uint64_t> last_price_scaled{0};
    uint64_t signals = 0;
    uint64_t next_order_id = 1;
    bool previous_signal_state = false;
    DashboardTradeState trade_state;
    std::mutex trade_state_mu;

    store.append("SYSTEM_START", "{\"app\":\"prism_live_paper_trading_v3\",\"mode\":\"live-paper\"}");
    dashboard.write_snapshot(0, 0, "live-paper", portfolio, risk.equity(), risk.daily_realized_pnl(), 0.0, 0.0, 0.0, trade_state);

    std::thread parser_thread([&]() {
        RawTradeMessage raw{}; TradePacket p{};
        while (running.load(std::memory_order_relaxed)) {
            if (raw_trade_queue.pop(raw)) {
                if (!json_trade_parser::parse_trade_packet(raw, p)) {
                    parse_dropped.fetch_add(1, std::memory_order_relaxed);
                    continue;
                }
                while (!trade_queue.push(p)) {
                    PAUSE();
                    if (!running.load(std::memory_order_relaxed)) break;
                }
                parsed.fetch_add(1, std::memory_order_relaxed);
            } else {
                PAUSE();
            }
        }
    });

    std::thread engine_thread([&]() {
        TradePacket p{};
        while (running.load(std::memory_order_relaxed)) {
            if (trade_queue.pop(p)) {
                const uint64_t start = now_ns();
                const std::string symbol = p.symbol[0] ? std::string(p.symbol) : args.symbol;
                prism.on_trade(p);
                portfolio.mark(symbol, p.price);

                const bool demo_fire = args.force_demo_signal && processed.load(std::memory_order_relaxed) == 50;
                const bool sig_now = prism.has_signal();
                {
                    std::lock_guard<std::mutex> lock(trade_state_mu);
                    if (trade_state.open_trade && trade_state.open_symbol == symbol) {
                        const double risk_per_unit = std::max(0.01, std::abs(trade_state.open_entry - trade_state.open_stop));
                        trade_state.open_current_r = (p.price - trade_state.open_entry) / risk_per_unit;
                        if (p.price <= trade_state.open_stop) {
                            close_paper_trade("STOP_LOSS", p.price, p.exchange_ts_ns, next_order_id, portfolio, broker, store, trade_state);
                        } else if (p.price >= trade_state.open_target2) {
                            close_paper_trade("TARGET_2", p.price, p.exchange_ts_ns, next_order_id, portfolio, broker, store, trade_state);
                        } else if (p.price >= trade_state.open_target1) {
                            close_paper_trade("TARGET_1", p.price, p.exchange_ts_ns, next_order_id, portfolio, broker, store, trade_state);
                        }
                    }
                    if (!trade_state.open_trade) {
                        if (demo_fire) {
                            submit_paper_order(symbol, "FORCED_LIVE_PAPER_DEMO_SIGNAL", p.price, p.price * 0.9975,
                                               100.0, p.exchange_ts_ns, next_order_id, signals, prism_config.strategy, risk, portfolio, broker, store, trade_state);
                        } else if (sig_now && !previous_signal_state) {
                            const auto sig = prism.last_signal();
                            submit_paper_order(symbol, sig.reason, sig.entry_price, sig.stop_loss,
                                               sig.setup_score, p.exchange_ts_ns, next_order_id, signals, prism_config.strategy, risk, portfolio, broker, store, trade_state);
                        }
                    }
                }
                previous_signal_state = sig_now;
                processed.fetch_add(1, std::memory_order_relaxed);
                last_price_scaled.store(static_cast<uint64_t>(p.price * 100.0), std::memory_order_relaxed);

                const uint64_t end = now_ns();
                engine_latency.observe(end - start);
                if (p.ingest_ts_ns > 0 && end > p.ingest_ts_ns) ingest_latency.observe(end - p.ingest_ts_ns);
            } else {
                PAUSE();
            }
        }
    });

    std::thread feed_thread([&]() { client.run(); });

    std::cout << "PRISMFlow LIVE PAPER Trading App v5\n"
              << "Live feed: Binance WebSocket " << args.symbol << "@trade\n"
              << "Execution: C++ PaperBroker + RiskManager + PositionSizer + Portfolio + EventStore\n"
              << "Config: " << (args.config_path.empty() ? "DEFAULT_CPP_CONFIG" : args.config_path) << " strategy_id=" << prism_config.strategy_id << " bar_seconds=" << args.bar_seconds << " lookback=" << prism_config.strategy.breakout_lookback << " min_score=" << prism_config.strategy.min_setup_score << " risk_pct=" << prism_config.strategy.risk.risk_per_trade_pct << " t1_R=" << prism_config.strategy.targets.target1_R << " t2_R=" << prism_config.strategy.targets.target2_R << "\n"
              << "Outputs: " << out_dir << "/\n"
              << "Dashboard: " << out_dir << "/dashboard/index.html\n"
              << "Run dashboard server in another CMD: scripts\\run_dashboard_server_windows.bat\n"
              << "Press Ctrl+C to stop.\n";

    uint64_t last_processed = 0;
    auto last_snapshot = std::chrono::steady_clock::now();
    while (running.load(std::memory_order_relaxed)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        const auto now = std::chrono::steady_clock::now();
        const uint64_t proc = processed.load(std::memory_order_relaxed);
        const uint64_t rate = (proc - last_processed) * 2;
        last_processed = proc;
        const double last_price = static_cast<double>(last_price_scaled.load(std::memory_order_relaxed)) / 100.0;
        if (std::chrono::duration_cast<std::chrono::milliseconds>(now - last_snapshot).count() >= args.snapshot_ms) {
            DashboardTradeState snapshot_state;
            {
                std::lock_guard<std::mutex> lock(trade_state_mu);
                push_equity(trade_state, 100000.0 + portfolio.total_realized_pnl() + portfolio.total_unrealized_pnl());
                snapshot_state = trade_state;
            }
            dashboard.write_snapshot(proc, signals, "live-paper", portfolio, risk.equity(), risk.daily_realized_pnl(),
                                     risk.daily_loss_utilization(),
                                     static_cast<double>(engine_latency.percentile_ns(95.0)) / 1000.0,
                                     static_cast<double>(engine_latency.percentile_ns(99.0)) / 1000.0,
                                     snapshot_state);
            store.metric("processed", static_cast<double>(proc));
            last_snapshot = now;
            std::cout << "live_paper_rate_msg_s=" << rate
                      << " processed=" << proc
                      << " ws_received=" << client.received()
                      << " ws_dropped=" << client.dropped()
                      << " parse_dropped=" << parse_dropped.load(std::memory_order_relaxed)
                      << " last_price=" << last_price
                      << " strategy_id=" << prism_config.strategy_id
                      << " cfg_lookback=" << prism_config.strategy.breakout_lookback
                      << " cfg_min_score=" << prism_config.strategy.min_setup_score
                      << " cfg_risk_pct=" << prism_config.strategy.risk.risk_per_trade_pct
                      << " cfg_t1_R=" << prism_config.strategy.targets.target1_R
                      << " cfg_t2_R=" << prism_config.strategy.targets.target2_R
                      << " bars=" << prism.bars_count()
                      << " signals=" << signals
                      << " open_positions=" << portfolio.open_position_count()
                      << " realized_pnl=" << portfolio.total_realized_pnl()
                      << " unrealized_pnl=" << portfolio.total_unrealized_pnl()
                      << " open_trade=" << (snapshot_state.open_trade ? 1 : 0)
                      << " total_trades=" << snapshot_state.total_trades
                      << " wins=" << snapshot_state.wins
                      << " losses=" << snapshot_state.losses
                      << " breakevens=" << snapshot_state.breakevens
                      << " gross_R=" << snapshot_state.gross_r
                      << " avg_R=" << snapshot_state.avg_r
                      << " open_side=" << snapshot_state.open_side
                      << " open_entry=" << snapshot_state.open_entry
                      << " open_stop=" << snapshot_state.open_stop
                      << " target1=" << snapshot_state.open_target1
                      << " target2=" << snapshot_state.open_target2
                      << " current_R=" << snapshot_state.open_current_r
                      << " open_setup_score=" << snapshot_state.open_setup_score
                      << " last_setup_score=" << snapshot_state.last_setup_score
                      << " current_setup_score=" << (snapshot_state.open_trade ? snapshot_state.open_setup_score : snapshot_state.last_setup_score)
                      << " last_result=" << snapshot_state.last_result
                      << " last_R=" << snapshot_state.last_r
                      << " p95_engine_us=" << static_cast<double>(engine_latency.percentile_ns(95.0)) / 1000.0
                      << " p99_engine_us=" << static_cast<double>(engine_latency.percentile_ns(99.0)) / 1000.0
                      << " p95_ingest_us=" << static_cast<double>(ingest_latency.percentile_ns(95.0)) / 1000.0
                      << "\n";
            std::cout << "QUANTOS_HEARTBEAT {"
                      << "\"symbol\":\"" << args.symbol << "\","
                      << "\"latest_price\":" << last_price << ","
                      << "\"equity\":" << (100000.0 + portfolio.total_realized_pnl() + portfolio.total_unrealized_pnl()) << ","
                      << "\"cash\":" << (100000.0 + portfolio.total_realized_pnl()) << ","
                      << "\"realized_pnl\":" << portfolio.total_realized_pnl() << ","
                      << "\"unrealized_pnl\":" << portfolio.total_unrealized_pnl() << ","
                      << "\"position_qty\":" << snapshot_state.open_qty << ","
                      << "\"open_side\":\"" << (snapshot_state.open_trade ? snapshot_state.open_side : "") << "\","
                      << "\"open_qty\":" << snapshot_state.open_qty << ","
                      << "\"open_entry\":" << snapshot_state.open_entry << ","
                      << "\"open_stop\":" << snapshot_state.open_stop << ","
                      << "\"target1\":" << snapshot_state.open_target1 << ","
                      << "\"target2\":" << snapshot_state.open_target2 << ","
                      << "\"current_R\":" << snapshot_state.open_current_r << ","
                      << "\"open_positions\":[";
            if (snapshot_state.open_trade && snapshot_state.open_qty > 0.0) {
                std::cout << "{\"symbol\":\"" << args.symbol << "\","
                          << "\"side\":\"" << snapshot_state.open_side << "\","
                          << "\"entry_price\":" << snapshot_state.open_entry << ","
                          << "\"qty\":" << snapshot_state.open_qty << ","
                          << "\"current_price\":" << last_price << ","
                          << "\"current_R\":" << snapshot_state.open_current_r << ","
                          << "\"unrealized_pnl\":" << portfolio.total_unrealized_pnl() << ","
                          << "\"stop\":" << snapshot_state.open_stop << ","
                          << "\"target1\":" << snapshot_state.open_target1 << ","
                          << "\"target2\":" << snapshot_state.open_target2 << "}";
            }
            std::cout << "],"
                      << "\"trades\":" << snapshot_state.total_trades << ","
                      << "\"wins\":" << snapshot_state.wins << ","
                      << "\"losses\":" << snapshot_state.losses << ","
                      << "\"breakevens\":" << snapshot_state.breakevens << ","
                      << "\"gross_R\":" << snapshot_state.gross_r << ","
                      << "\"avg_R\":" << snapshot_state.avg_r << ","
                      << "\"last_result\":\"" << snapshot_state.last_result << "\","
                      << "\"processed\":" << proc << ","
                      << "\"bars\":" << prism.bars_count() << ","
                      << "\"signals\":" << signals << ","
                      << "\"p50_latency_us\":" << static_cast<double>(engine_latency.percentile_ns(50.0)) / 1000.0 << ","
                      << "\"p95_latency_us\":" << static_cast<double>(engine_latency.percentile_ns(95.0)) / 1000.0 << ","
                      << "\"p99_latency_us\":" << static_cast<double>(engine_latency.percentile_ns(99.0)) / 1000.0 << ","
                      << "\"feed_status\":\"" << (last_price > 0.0 ? "connected" : "waiting_for_feed") << "\","
                      << "\"mode\":\"paper\""
                      << "}\n" << std::flush;
        }
    }

    client.stop();
    if (feed_thread.joinable()) feed_thread.join();
    if (parser_thread.joinable()) parser_thread.join();
    if (engine_thread.joinable()) engine_thread.join();

    DashboardTradeState final_state;
    {
        std::lock_guard<std::mutex> lock(trade_state_mu);
        const double final_price = static_cast<double>(last_price_scaled.load(std::memory_order_relaxed)) / 100.0;
        if (trade_state.open_trade && final_price > 0.0) {
            close_paper_trade("USER_STOP_EXIT", final_price, now_ns(), next_order_id, portfolio, broker, store, trade_state);
        }
        final_state = trade_state;
    }
    dashboard.write_snapshot(processed.load(std::memory_order_relaxed), signals, "live-paper", portfolio,
                             risk.equity(), risk.daily_realized_pnl(), risk.daily_loss_utilization(),
                             static_cast<double>(engine_latency.percentile_ns(95.0)) / 1000.0,
                             static_cast<double>(engine_latency.percentile_ns(99.0)) / 1000.0,
                             final_state);
    store.append("SYSTEM_STOP", "{\"reason\":\"user_stop\"}");
    std::ofstream summary(out_dir + "/live_session_summary.json");
    summary << "{\n  \"mode\": \"live-paper\",\n  \"symbol\": \"" << args.symbol << "\",\n"
            << "  \"strategy_id\": \"" << prism_config.strategy_id << "\",\n"
            << "  \"config_path\": \"" << args.config_path << "\",\n"
            << "  \"processed\": " << processed.load(std::memory_order_relaxed) << ",\n"
            << "  \"signals\": " << signals << ",\n"
            << "  \"realized_pnl\": " << portfolio.total_realized_pnl() << ",\n"
            << "  \"unrealized_pnl\": " << portfolio.total_unrealized_pnl() << ",\n"
            << "  \"total_trades\": " << final_state.total_trades << ",\n"
            << "  \"wins\": " << final_state.wins << ",\n"
            << "  \"losses\": " << final_state.losses << ",\n"
            << "  \"gross_R\": " << final_state.gross_r << ",\n"
            << "  \"avg_R\": " << final_state.avg_r << "\n}\n";

    std::cout << "Stopped. Generated live paper files: live_trade_log.csv, live_session_summary.json, live_dashboard_snapshot.json, events.jsonl, ledger.csv, dashboard/snapshot.json\n";
    return 0;
}
