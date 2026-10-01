#include "connectors/BinanceClient.h"
#include "engine_shared.hpp"
#include "json_trade_parser.hpp"
#include "market_data/binance_depth_parser.hpp"
#include "order_book.hpp"
#include "prism_live_engine.hpp"
#include "time_utils.hpp"
#include "trade_manager.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <csignal>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

RawTradeQueue raw_trade_queue;
TradeQueue trade_queue;
RawMarketQueue raw_market_queue;
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
        const uint64_t count = count_.load(std::memory_order_relaxed);
        return count == 0 ? 0 : total_ns_.load(std::memory_order_relaxed) / count;
    }
    uint64_t percentile_ns(double percentile) const {
        const uint64_t count = count_.load(std::memory_order_relaxed);
        const std::size_t n = static_cast<std::size_t>(std::min<uint64_t>(count, kWindowSize));
        if (n == 0) return 0;
        std::vector<uint64_t> values;
        values.reserve(n);
        for (std::size_t i = 0; i < n; ++i) {
            const uint64_t value = samples_[i].load(std::memory_order_relaxed);
            if (value > 0) values.push_back(value);
        }
        if (values.empty()) return 0;
        std::sort(values.begin(), values.end());
        const double clamped = std::max(0.0, std::min(100.0, percentile));
        return values[static_cast<std::size_t>((clamped / 100.0) * static_cast<double>(values.size() - 1))];
    }
private:
    static constexpr std::size_t kWindowSize = 4096;
    std::array<std::atomic<uint64_t>, kWindowSize> samples_{};
    std::atomic<uint64_t> write_index_{0}, count_{0}, total_ns_{0}, current_ns_{0}, max_ns_{0};
};

void print_signal_banner(const PrismSignal& signal) {
    std::cout << "\n========== PRISM SIGNAL GENERATED =========="
              << "\nEntry  : " << signal.entry_price
              << "\nStop   : " << signal.stop_loss
              << "\nTarget1: " << signal.target1
              << "\nTarget2: " << signal.target2
              << "\nScore  : " << signal.setup_score
              << "\nReason : " << signal.reason
              << "\n===========================================\n\n";
}

void write_system_score_json(const std::string& path, const BinanceClient& client, const TradeManager& trade_manager,
                             uint64_t processed, uint64_t parsed, uint64_t parse_dropped,
                             const LatencyStats& engine_latency_stats, const LatencyStats& ingest_latency_stats,
                             const BookSnapshot& book_snapshot) {
    std::ofstream out(path, std::ios::out);
    if (!out.is_open()) return;
    const uint64_t ws_received = client.received();
    const uint64_t ws_dropped = client.dropped();
    const uint64_t total_ws = ws_received + ws_dropped;
    const double drop_rate = total_ws == 0 ? 0.0 : static_cast<double>(ws_dropped) / static_cast<double>(total_ws);
    const double reliability_score = std::max(0.0, 100.0 - drop_rate * 1000.0);
    const double latency_ms = static_cast<double>(engine_latency_stats.percentile_ns(95.0)) / 1000000.0;
    const double latency_score = std::max(0.0, 100.0 - latency_ms / 5.0);
    const double avg_r = trade_manager.average_r();
    const double strategy_score = std::max(0.0, std::min(100.0, 50.0 + avg_r * 50.0));
    const double system_score = reliability_score * 0.40 + latency_score * 0.25 + strategy_score * 0.35;
    out << "{\n"
        << "  \"project_name\": \"QuantOS Low-Latency Market Data Engine\",\n"
        << "  \"ws_received\": " << ws_received << ",\n"
        << "  \"ws_dropped\": " << ws_dropped << ",\n"
        << "  \"market_ws_received\": " << client.market_received() << ",\n"
        << "  \"market_ws_dropped\": " << client.market_dropped() << ",\n"
        << "  \"parse_dropped\": " << parse_dropped << ",\n"
        << "  \"total_processed\": " << processed << ",\n"
        << "  \"total_parsed\": " << parsed << ",\n"
        << "  \"book_sequence\": " << book_snapshot.sequence << ",\n"
        << "  \"book_updates\": " << book_snapshot.updates << ",\n"
        << "  \"book_invalid_updates\": " << book_snapshot.invalid_updates << ",\n"
        << "  \"best_bid\": " << book_snapshot.best_bid << ",\n"
        << "  \"best_ask\": " << book_snapshot.best_ask << ",\n"
        << "  \"spread\": " << book_snapshot.spread << ",\n"
        << "  \"mid_price\": " << book_snapshot.mid_price << ",\n"
        << "  \"depth_imbalance\": " << book_snapshot.depth_imbalance << ",\n"
        << "  \"vwap_bid\": " << book_snapshot.vwap_bid << ",\n"
        << "  \"vwap_ask\": " << book_snapshot.vwap_ask << ",\n"
        << "  \"p95_engine_latency_ns\": " << engine_latency_stats.percentile_ns(95.0) << ",\n"
        << "  \"p99_engine_latency_ns\": " << engine_latency_stats.percentile_ns(99.0) << ",\n"
        << "  \"p95_ingest_to_engine_latency_ns\": " << ingest_latency_stats.percentile_ns(95.0) << ",\n"
        << "  \"latency_score\": " << latency_score << ",\n"
        << "  \"reliability_score\": " << reliability_score << ",\n"
        << "  \"strategy_score\": " << strategy_score << ",\n"
        << "  \"system_score\": " << system_score << "\n} \n";
}

} // namespace

int main(int argc, char** argv) {
    std::string symbol = "btcusdt";
    if (argc >= 2) symbol = argv[1];
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    L2OrderBook l2_book;
    PrismLiveEngine prism(10);
    TradeManager trade_manager("trade_log.csv");
    std::atomic<uint64_t> processed{0}, parsed{0}, parse_dropped{0}, book_updates{0}, book_parse_dropped{0};
    LatencyStats engine_latency_stats, ingest_latency_stats;
    static constexpr double kPriceScale = 100000000.0; // 8 decimal places (Satoshi precision)
    std::atomic<uint64_t> last_price_scaled{0}, prism_signals{0};
    std::atomic<double> best_bid{0.0}, best_ask{0.0}, mid_price{0.0}, spread{0.0}, imbalance{0.0};
    BinanceClient client(symbol, true);

    std::thread trade_parser_thread([&]() {
        RawTradeMessage raw{}; TradePacket parsed_packet{};
        while (running.load(std::memory_order_relaxed)) {
            if (raw_trade_queue.pop(raw)) {
                if (!json_trade_parser::parse_trade_packet(raw, parsed_packet)) {
                    parse_dropped.fetch_add(1, std::memory_order_relaxed);
                    continue;
                }
                while (!trade_queue.push(parsed_packet)) {
                    PAUSE();
                    if (!running.load(std::memory_order_relaxed)) break;
                }
                parsed.fetch_add(1, std::memory_order_relaxed);
            } else PAUSE();
        }
    });

    std::thread book_thread([&]() {
        RawMarketMessage raw{}; L2Update update{};
        while (running.load(std::memory_order_relaxed)) {
            if (raw_market_queue.pop(raw)) {
                if (!quantos::market_data::binance_depth_parser::parse_l2_update(raw, update)) {
                    book_parse_dropped.fetch_add(1, std::memory_order_relaxed);
                    continue;
                }
                l2_book.apply_incremental(update, true);
                const BookSnapshot s = l2_book.snapshot(10);
                best_bid.store(s.best_bid, std::memory_order_relaxed);
                best_ask.store(s.best_ask, std::memory_order_relaxed);
                mid_price.store(s.mid_price, std::memory_order_relaxed);
                spread.store(s.spread, std::memory_order_relaxed);
                imbalance.store(s.depth_imbalance, std::memory_order_relaxed);
                book_updates.store(s.updates, std::memory_order_relaxed);
            } else PAUSE();
        }
    });

    std::thread engine_thread([&]() {
        TradePacket p{}; bool previous_signal_state = false;
        while (running.load(std::memory_order_relaxed)) {
            if (trade_queue.pop(p)) {
                const uint64_t start = now_ns();
                prism.on_trade(p);
                trade_manager.on_price(p.price);
                const bool current_signal_state = prism.has_signal();
                if (current_signal_state && !previous_signal_state) {
                    const PrismSignal signal = prism.last_signal();
                    prism_signals.fetch_add(1, std::memory_order_relaxed);
                    print_signal_banner(signal);
                    trade_manager.on_signal(signal);
                }
                previous_signal_state = current_signal_state;
                processed.fetch_add(1, std::memory_order_relaxed);
                last_price_scaled.store(static_cast<uint64_t>(p.price * kPriceScale), std::memory_order_relaxed);
                const uint64_t end_ns = now_ns();
                engine_latency_stats.observe(end_ns - start);
                if (p.ingest_ts_ns > 0 && end_ns > p.ingest_ts_ns) ingest_latency_stats.observe(end_ns - p.ingest_ts_ns);
            } else PAUSE();
        }
    });

    std::thread feed_thread([&]() { client.run(); });

    std::cout << "QuantOS market-data engine running. Streams: " << symbol << "@trade + " << symbol << "@depth@100ms\n"
              << "L2 order book enabled. L3 abstraction compiled but not fed by Binance public stream because Binance public depth has no per-order IDs.\n";

    uint64_t last_processed = 0;
    while (running.load(std::memory_order_relaxed)) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        const uint64_t now_processed = processed.load(std::memory_order_relaxed);
        const uint64_t per_sec = (now_processed - last_processed) / 2;
        last_processed = now_processed;
        const double last_price = static_cast<double>(last_price_scaled.load(std::memory_order_relaxed)) / kPriceScale;
        std::cout << "live_rate_msg_s=" << per_sec
                  << " processed=" << now_processed
                  << " ws_received=" << client.received()
                  << " market_ws_received=" << client.market_received()
                  << " ws_dropped=" << client.dropped()
                  << " market_ws_dropped=" << client.market_dropped()
                  << " parse_dropped=" << parse_dropped.load(std::memory_order_relaxed)
                  << " book_parse_dropped=" << book_parse_dropped.load(std::memory_order_relaxed)
                  << " raw_queue=" << raw_trade_queue.size_approx()
                  << " market_queue=" << raw_market_queue.size_approx()
                  << " trade_queue=" << trade_queue.size_approx()
                  << " last_price=" << last_price
                  << " best_bid=" << best_bid.load(std::memory_order_relaxed)
                  << " best_ask=" << best_ask.load(std::memory_order_relaxed)
                  << " spread=" << spread.load(std::memory_order_relaxed)
                  << " mid=" << mid_price.load(std::memory_order_relaxed)
                  << " imbalance=" << imbalance.load(std::memory_order_relaxed)
                  << " book_updates=" << book_updates.load(std::memory_order_relaxed)
                  << " book_invalid=" << l2_book.invalid_updates()
                  << " bars=" << prism.bars_count()
                  << " prism_signals=" << prism_signals.load(std::memory_order_relaxed)
                  << " p95_engine_ns=" << engine_latency_stats.percentile_ns(95.0)
                  << " p99_engine_ns=" << engine_latency_stats.percentile_ns(99.0)
                  << "\n";
    }

    client.stop();
    if (feed_thread.joinable()) feed_thread.join();
    if (trade_parser_thread.joinable()) trade_parser_thread.join();
    if (book_thread.joinable()) book_thread.join();
    if (engine_thread.joinable()) engine_thread.join();

    const BookSnapshot final_book = l2_book.snapshot(10);
    write_system_score_json("system_score.json", client, trade_manager,
                            processed.load(std::memory_order_relaxed),
                            parsed.load(std::memory_order_relaxed),
                            parse_dropped.load(std::memory_order_relaxed),
                            engine_latency_stats, ingest_latency_stats, final_book);

    trade_manager.write_summary_json("backtest_summary.json");
    return 0;
}
