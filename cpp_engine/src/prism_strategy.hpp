#pragma once

#include "PrismConfig.hpp"

#include <cstdint>
#include <deque>
#include <string>

struct Bar {
    uint64_t ts = 0;
    double open = 0.0;
    double high = 0.0;
    double low = 0.0;
    double close = 0.0;
    double volume = 0.0;
    double atr_14 = 0.0;
};

class PrismStrategy {
public:
    enum class State { IDLE, BREAKOUT, RETEST };

    struct Signal {
        bool valid = false;
        double entry_price = 0.0;
        double stop_loss = 0.0;
        double target1 = 0.0;
        double target2 = 0.0;
        double setup_score = 0.0;
        std::string reason;
    };

    PrismStrategy();
    explicit PrismStrategy(const StrategyRulesConfig& config);

    void on_new_bar(const Bar& bar);
    bool has_signal() const;
    Signal current_signal() const;
    uint64_t bars_processed() const;
    const StrategyRulesConfig& config() const;

private:
    void detect_breakout(const Bar& bar);
    void detect_retest(const Bar& bar);
    double calculate_score(const Bar& bar);
    double average_volume(size_t lookback) const;
    void update_trend_filter(const Bar& bar);
    bool trend_filter_allows_long() const;
    void update_rsi(const Bar& bar);
    bool rsi_filter_allows_long() const;
    void update_macd(const Bar& bar);
    bool macd_filter_allows_long() const;
    void update_extrema(const Bar& bar);
    bool has_two_top_bearish_rsi() const;
    bool has_two_bottom_bullish_rsi() const;
    bool has_two_top_bearish_macd() const;
    bool has_two_bottom_bullish_macd() const;

public:
    double current_rsi() const { return current_rsi_; }
    double current_macd() const { return macd_line_; }
    double current_macd_signal() const { return macd_signal_; }
    double current_macd_hist() const { return macd_histogram_; }

private:
    struct ExtremaPoint {
        double price = 0.0;
        double rsi = 50.0;
        double macd = 0.0;
        double hist = 0.0;
        uint64_t bar_index = 0;
    };

    StrategyRulesConfig config_;
    std::deque<Bar> history_;
    State state_ = State::IDLE;
    Signal signal_;
    uint64_t bars_processed_ = 0;
    uint64_t breakout_bar_index_ = 0;
    uint64_t last_signal_bar_ = 0;
    double breakout_level_ = 0.0;
    uint64_t bars_since_htf_close_ = 0;
    bool ema_seeded_ = false;
    double htf_fast_ema_ = 0.0;
    double htf_slow_ema_ = 0.0;

    // RSI O(1) streaming state
    double prev_close_ = 0.0;
    double rsi_avg_gain_ = 0.0;
    double rsi_avg_loss_ = 0.0;
    double rsi_sum_gain_ = 0.0;
    double rsi_sum_loss_ = 0.0;
    double current_rsi_ = 50.0;
    uint64_t rsi_bar_count_ = 0;

    // MACD O(1) streaming state
    double macd_fast_ema_ = 0.0;
    double macd_slow_ema_ = 0.0;
    double macd_signal_ = 0.0;
    double macd_line_ = 0.0;
    double macd_histogram_ = 0.0;
    double prev_macd_histogram_ = 0.0;
    bool macd_seeded_ = false;

    // Swing extrema tracker (zero allocation)
    double ext_h0_ = 0, ext_h1_ = 0, ext_h2_ = 0;
    double ext_l0_ = 0, ext_l1_ = 0, ext_l2_ = 0;
    double ext_rsi0_ = 50, ext_rsi1_ = 50, ext_rsi2_ = 50;
    double ext_macd0_ = 0, ext_macd1_ = 0, ext_macd2_ = 0;
    double ext_hist0_ = 0, ext_hist1_ = 0, ext_hist2_ = 0;
    uint64_t ext_bars_ = 0;
    ExtremaPoint peak1_, peak2_;
    ExtremaPoint trough1_, trough2_;
    uint64_t peak_count_ = 0;
    uint64_t trough_count_ = 0;
};
