#pragma once

#include "engine_shared.hpp"
#include "PrismConfig.hpp"
#include "prism_strategy.hpp"

#include <atomic>
#include <deque>
#include <string>
#include <vector>
#include <cstdint>

struct PrismBar {
    std::string timestamp;
    double open = 0.0;
    double high = 0.0;
    double low = 0.0;
    double close = 0.0;
    double volume = 0.0;
    double vwap = 0.0;
    double atr_14 = 0.0;
};

struct PrismSignal {
    bool active = false;
    std::string reason;

    double entry_price = 0.0;
    double stop_loss = 0.0;
    double target1 = 0.0;
    double target2 = 0.0;
    double setup_score = 0.0;
};

class PrismLiveEngine {
public:
    explicit PrismLiveEngine(int bar_seconds = 60);
    PrismLiveEngine(int bar_seconds, const StrategyRulesConfig& strategy_config);

    void on_trade(const TradePacket& trade);

    bool has_signal() const;
    PrismSignal last_signal() const;

    size_t bars_count() const;
    double last_close() const;

private:
    int bar_seconds_;

    bool has_current_bar_ = false;
    uint64_t current_bar_start_ns_ = 0;

    PrismBar current_bar_;
    std::deque<PrismBar> bars_;

    PrismSignal last_signal_;
    PrismStrategy strategy_;

private:
    void start_new_bar(const TradePacket& trade);
    void update_current_bar(const TradePacket& trade);
    void close_current_bar();

    void compute_atr();
    void evaluate_prism();

    double previous_20_bar_high() const;
    double compute_setup_score(const PrismBar& bar) const;
};

// Headless TCP Engine Daemon for sub-millisecond co-located institutional tick-to-trade
struct HeadlessTcpDaemonConfig {
    int port = 9876;
    int max_clients = 64;
    bool verbose = false;
};

class HeadlessTcpDaemon {
public:
    explicit HeadlessTcpDaemon(PrismLiveEngine& engine, HeadlessTcpDaemonConfig cfg = {});
    ~HeadlessTcpDaemon();

    bool start();
    void stop();
    bool is_running() const;

private:
    PrismLiveEngine& engine_;
    HeadlessTcpDaemonConfig cfg_;
    std::atomic<bool> running_{false};
    void* thread_handle_{nullptr};

    void run_event_loop();
    static void thread_entry(void* param);
};
