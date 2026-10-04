#pragma once

#include <string>
#include <vector>

struct StopLossConfig {
    std::string type = "atr_or_structure";
    double atr_multiplier = 0.75;
    double structure_buffer_pct = 0.25;
};

struct TargetConfig {
    double target1_R = 1.5;
    double target2_R = 2.5;
};

struct RiskConfigPrism {
    double risk_per_trade_pct = 1.0;
    double max_daily_loss_pct = 3.0;
    int max_open_positions = 5;
    double max_symbol_notional = 10000.0;
};

struct ReentryConfig {
    bool enabled = true;
    int max_reentries = 1;
    int cooldown_bars = 10;
};

struct TrendFilterConfig {
    bool use_trend_filter = false;
    std::string higher_timeframe = "5m";
    int higher_timeframe_seconds = 300;
    int fast_ema = 20;
    int slow_ema = 50;
};

struct TradeManagementConfig {
    bool breakeven_stop = true;
    double partial_tp_pct = 50.0;
    bool trailing_stop = false;
    double trailing_atr_multiplier = 1.5;
};

struct ExecutionFrictionConfig {
    double fee_pct = 0.04;
    double slippage_pct = 0.01;
};

struct TimingFilterConfig {
    std::string trading_hours = "all_day";
    bool skip_weekends = false;
    bool rvol_filter = false;
    double rvol_threshold = 1.5;
};

struct StrategyRulesConfig {
    std::string name = "QuantOS Breakout Retest";
    std::string direction = "both";
    int breakout_lookback = 20;
    double retest_tolerance_pct = 0.001;
    double min_setup_score = 6.5;
    int max_retest_bars = 30;
    int signal_cooldown_bars = 5;
    int ttl_bars = 40;
    double min_close_position = 0.50;
    StopLossConfig stop_loss;
    TargetConfig targets;
    RiskConfigPrism risk;
    ReentryConfig reentry;
    TrendFilterConfig trend_filter;
    TradeManagementConfig trade_management;
    ExecutionFrictionConfig execution_friction;
    TimingFilterConfig timing_filter;
};

struct PrismConfig {
    std::string user_id = "local_user";
    std::string strategy_id = "local_strategy";
    std::string job_id = "local_job";
    std::string mode = "backtest";
    std::vector<std::string> symbols{"btcusdt"};
    std::string timeframe = "1m";
    int bar_seconds = 60;
    StrategyRulesConfig strategy;
    std::string input_data = "data/sample_market_data.csv";
    std::string output_dir = "outputs/local_user/local_job";
};
