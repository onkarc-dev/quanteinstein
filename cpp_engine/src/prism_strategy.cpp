#include "prism_strategy.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>

namespace {
static constexpr bool DEBUG_BAR_LOGS = false;
static constexpr bool DEBUG_RETEST_LOGS = false;
}

PrismStrategy::PrismStrategy() : PrismStrategy(StrategyRulesConfig{}) {}

PrismStrategy::PrismStrategy(const StrategyRulesConfig& config)
    : config_(config) {}

void PrismStrategy::on_new_bar(const Bar& bar) {
    ++bars_processed_;
    history_.push_back(bar);
    if (history_.size() > 500) history_.pop_front();
    update_trend_filter(bar);
    signal_ = Signal{};

    const size_t lookback = static_cast<size_t>(std::max(1, config_.breakout_lookback));
    if (DEBUG_BAR_LOGS) {
        std::cout << "[BAR] index=" << bars_processed_ << " close=" << bar.close
                  << " atr14=" << bar.atr_14 << " state=" << static_cast<int>(state_) << "\n";
    }
    if (history_.size() < lookback + 1) return;

    if (state_ == State::IDLE) {
        detect_breakout(bar);
    } else {
        detect_retest(bar);
    }
}

void PrismStrategy::detect_breakout(const Bar& bar) {
    const uint64_t cooldown = static_cast<uint64_t>(std::max(0, config_.signal_cooldown_bars));
    if (bars_processed_ - last_signal_bar_ < cooldown) return;

    const size_t lookback = static_cast<size_t>(std::max(1, config_.breakout_lookback));
    double previous_high = history_[history_.size() - lookback - 1].high;
    for (size_t i = history_.size() - lookback; i < history_.size() - 1; ++i) {
        previous_high = std::max(previous_high, history_[i].high);
    }
    if (bar.close > previous_high) {
        breakout_level_ = previous_high;
        breakout_bar_index_ = bars_processed_;
        state_ = State::BREAKOUT;
        if (DEBUG_RETEST_LOGS) {
            std::cout << "[BREAKOUT_FOUND] close=" << bar.close << " level=" << breakout_level_
                      << " bar_index=" << breakout_bar_index_ << "\n";
        }
    }
}

void PrismStrategy::detect_retest(const Bar& bar) {
    if (breakout_level_ <= 0.0) { state_ = State::IDLE; return; }
    const uint64_t bars_since_breakout = bars_processed_ - breakout_bar_index_;
    if (bars_since_breakout > static_cast<uint64_t>(std::max(1, config_.max_retest_bars))) {
        state_ = State::IDLE; breakout_level_ = 0.0; breakout_bar_index_ = 0;
        if (DEBUG_RETEST_LOGS) {
            std::cout << "[RETEST_EXPIRED] bars_since_breakout=" << bars_since_breakout << "\n";
        }
        return;
    }
    if (bars_processed_ - last_signal_bar_ < static_cast<uint64_t>(std::max(0, config_.signal_cooldown_bars))) {
        state_ = State::IDLE; breakout_level_ = 0.0; breakout_bar_index_ = 0; return;
    }

    const double range = bar.high - bar.low;
    if (range <= 0.0) return;
    const double tolerance = breakout_level_ * config_.retest_tolerance_pct;
    const bool touched_breakout = bar.low <= breakout_level_ + tolerance;
    const double close_position = (bar.close - bar.low) / range;
    const double score = calculate_score(bar);
    const bool accepted = touched_breakout && close_position >= config_.min_close_position && bar.close >= breakout_level_ && trend_filter_allows_long();

    if (DEBUG_RETEST_LOGS) {
        std::cout << "[RETEST_CHECK] close=" << bar.close << " breakout=" << breakout_level_
                  << " close_position=" << close_position << " accepted=" << accepted
                  << " score=" << score << "\n";
    }
    if (!accepted || score < config_.min_setup_score) { state_ = State::RETEST; return; }

    const double entry = bar.close;
    const double atr_component = (bar.atr_14 > 0.0) ? bar.atr_14 * config_.stop_loss.atr_multiplier : range * 1.25;
    const double structure_stop = bar.low - (range * config_.stop_loss.structure_buffer_pct);
    const double atr_stop = entry - atr_component;
    const double stop = std::min(structure_stop, atr_stop);
    const double risk = entry - stop;
    if (risk <= 0.0) { state_ = State::RETEST; return; }

    signal_.valid = true;
    signal_.entry_price = entry;
    signal_.stop_loss = stop;
    signal_.target1 = entry + risk * config_.targets.target1_R;
    signal_.target2 = entry + risk * config_.targets.target2_R;
    signal_.setup_score = score;
    signal_.reason = config_.trend_filter.use_trend_filter ? "PRISM_ATR_BREAKOUT_RETEST_HTF_EMA_FILTER" : "PRISM_ATR_BREAKOUT_RETEST_CONFIG_MODE";
    last_signal_bar_ = bars_processed_;
    state_ = State::IDLE;
    breakout_level_ = 0.0;
    breakout_bar_index_ = 0;
}

void PrismStrategy::update_trend_filter(const Bar& bar) {
    if (!config_.trend_filter.use_trend_filter) return;
    ++bars_since_htf_close_;
    const uint64_t factor = 1;
    if (bars_since_htf_close_ < factor) return;
    bars_since_htf_close_ = 0;
    const int fast_len = std::max(1, config_.trend_filter.fast_ema);
    const int slow_len = std::max(fast_len + 1, config_.trend_filter.slow_ema);
    const double alpha_fast = 2.0 / (static_cast<double>(fast_len) + 1.0);
    const double alpha_slow = 2.0 / (static_cast<double>(slow_len) + 1.0);
    if (!ema_seeded_) {
        htf_fast_ema_ = bar.close;
        htf_slow_ema_ = bar.close;
        ema_seeded_ = true;
    } else {
        htf_fast_ema_ = alpha_fast * bar.close + (1.0 - alpha_fast) * htf_fast_ema_;
        htf_slow_ema_ = alpha_slow * bar.close + (1.0 - alpha_slow) * htf_slow_ema_;
    }
}

bool PrismStrategy::trend_filter_allows_long() const {
    if (!config_.trend_filter.use_trend_filter) return true;
    if (!ema_seeded_) return true;
    return htf_fast_ema_ >= htf_slow_ema_;
}

double PrismStrategy::calculate_score(const Bar& bar) {
    double score = 0.0;
    const double range = bar.high - bar.low;
    if (range > 0.0) {
        const double close_position = (bar.close - bar.low) / range;
        if (close_position >= 0.50) score += 3.0;
        if (close_position >= 0.75) score += 1.0;
    }
    if (bar.close >= bar.open) score += 2.0;

    const double avg_vol = average_volume(20);
    if (avg_vol > 0.0 && bar.volume > 0.0) {
        const double vol_ratio = bar.volume / avg_vol;
        if (vol_ratio >= 1.25) score += 1.5;
        else if (vol_ratio >= 1.0) score += 1.0;
        else score += 0.5;
    } else {
        score += 1.0;
    }

    if (trend_filter_allows_long()) {
        score += 2.0;
    } else {
        score += 0.5;
    }
    return std::min(score, 10.0);
}

double PrismStrategy::average_volume(size_t lookback) const {
    if (history_.empty()) return 0.0;
    const size_t n = std::min(lookback, history_.size());
    double sum = 0.0;
    for (size_t i = history_.size() - n; i < history_.size(); ++i) sum += history_[i].volume;
    return sum / static_cast<double>(n);
}

bool PrismStrategy::has_signal() const { return signal_.valid; }
PrismStrategy::Signal PrismStrategy::current_signal() const { return signal_; }
uint64_t PrismStrategy::bars_processed() const { return bars_processed_; }
const StrategyRulesConfig& PrismStrategy::config() const { return config_; }
