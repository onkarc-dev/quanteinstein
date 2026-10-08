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
    update_rsi(bar);
    update_macd(bar);
    update_extrema(bar);
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
    const bool rsi_ok = rsi_filter_allows_long();
    const bool macd_ok = macd_filter_allows_long();
    const bool accepted = touched_breakout && close_position >= config_.min_close_position && bar.close >= breakout_level_ && trend_filter_allows_long() && rsi_ok && macd_ok;

    if (DEBUG_RETEST_LOGS) {
        std::cout << "[RETEST_CHECK] close=" << bar.close << " breakout=" << breakout_level_
                  << " close_position=" << close_position << " accepted=" << accepted
                  << " score=" << score << " rsi_ok=" << rsi_ok << " macd_ok=" << macd_ok << "\n";
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
    std::string sig_reason = "PRISM_ATR_BREAKOUT_RETEST";
    if (config_.trend_filter.use_trend_filter) sig_reason += "_HTF_EMA";
    if (config_.rsi_filter.enabled) sig_reason += "_RSI";
    if (config_.macd_filter.enabled) sig_reason += "_MACD";
    signal_.reason = sig_reason;
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

    if (config_.rsi_filter.enabled) {
        if (rsi_filter_allows_long()) score += 1.0;
        else score -= 1.0;
    }
    if (config_.macd_filter.enabled) {
        if (macd_filter_allows_long()) score += 1.0;
        else score -= 1.0;
    }

    return std::min(std::max(0.0, score), 10.0);
}

void PrismStrategy::update_rsi(const Bar& bar) {
    const int p = std::max(2, config_.rsi_filter.period);
    if (rsi_bar_count_ == 0) {
        prev_close_ = bar.close;
        rsi_bar_count_ = 1;
        current_rsi_ = 50.0;
        return;
    }
    const double diff = bar.close - prev_close_;
    prev_close_ = bar.close;
    const double gain = diff > 0.0 ? diff : 0.0;
    const double loss = diff < 0.0 ? -diff : 0.0;
    rsi_bar_count_++;

    if (rsi_bar_count_ <= static_cast<uint64_t>(p + 1)) {
        rsi_sum_gain_ += gain;
        rsi_sum_loss_ += loss;
        if (rsi_bar_count_ == static_cast<uint64_t>(p + 1)) {
            rsi_avg_gain_ = rsi_sum_gain_ / static_cast<double>(p);
            rsi_avg_loss_ = rsi_sum_loss_ / static_cast<double>(p);
        }
    } else {
        rsi_avg_gain_ = (rsi_avg_gain_ * (p - 1) + gain) / static_cast<double>(p);
        rsi_avg_loss_ = (rsi_avg_loss_ * (p - 1) + loss) / static_cast<double>(p);
    }

    if (rsi_bar_count_ > static_cast<uint64_t>(p)) {
        if (rsi_avg_loss_ <= 1e-12) {
            current_rsi_ = (rsi_avg_gain_ <= 1e-12) ? 50.0 : 100.0;
        } else {
            const double rs = rsi_avg_gain_ / rsi_avg_loss_;
            current_rsi_ = 100.0 - (100.0 / (1.0 + rs));
        }
    }
}

bool PrismStrategy::rsi_filter_allows_long() const {
    if (!config_.rsi_filter.enabled) return true;
    const std::string& cond = config_.rsi_filter.condition;
    const double ob = config_.rsi_filter.overbought;
    const double os = config_.rsi_filter.oversold;

    if (cond == "two_bottom_bull_two_top_bear" || cond == "two_bottom_bull") {
        return has_two_bottom_bullish_rsi() || current_rsi_ <= os + 10.0;
    }
    if (cond == "momentum") {
        return current_rsi_ >= 50.0;
    }
    if (cond == "mean_reversion") {
        return current_rsi_ <= os;
    }
    // Default: "filter_extremes"
    return current_rsi_ <= ob;
}

void PrismStrategy::update_macd(const Bar& bar) {
    const int fast_p = std::max(1, config_.macd_filter.fast_period);
    const int slow_p = std::max(fast_p + 1, config_.macd_filter.slow_period);
    const int sig_p = std::max(1, config_.macd_filter.signal_period);

    const double alpha_f = 2.0 / (static_cast<double>(fast_p) + 1.0);
    const double alpha_s = 2.0 / (static_cast<double>(slow_p) + 1.0);
    const double alpha_sig = 2.0 / (static_cast<double>(sig_p) + 1.0);

    if (!macd_seeded_) {
        macd_fast_ema_ = bar.close;
        macd_slow_ema_ = bar.close;
        macd_line_ = 0.0;
        macd_signal_ = 0.0;
        macd_histogram_ = 0.0;
        prev_macd_histogram_ = 0.0;
        macd_seeded_ = true;
        return;
    }

    macd_fast_ema_ = alpha_f * bar.close + (1.0 - alpha_f) * macd_fast_ema_;
    macd_slow_ema_ = alpha_s * bar.close + (1.0 - alpha_s) * macd_slow_ema_;
    macd_line_ = macd_fast_ema_ - macd_slow_ema_;

    prev_macd_histogram_ = macd_histogram_;
    macd_signal_ = alpha_sig * macd_line_ + (1.0 - alpha_sig) * macd_signal_;
    macd_histogram_ = macd_line_ - macd_signal_;
}

bool PrismStrategy::macd_filter_allows_long() const {
    if (!config_.macd_filter.enabled) return true;
    if (!macd_seeded_) return true;
    const std::string& cond = config_.macd_filter.condition;

    if (cond == "two_top_bear_two_bottom_bull" || cond == "two_bottom_bull") {
        return has_two_bottom_bullish_macd() || (macd_histogram_ > prev_macd_histogram_ && prev_macd_histogram_ < 0.0);
    }
    if (cond == "signal_crossover") {
        return macd_line_ >= macd_signal_;
    }
    if (cond == "zero_line") {
        return macd_line_ >= 0.0;
    }
    // Default: "histogram_momentum"
    return macd_histogram_ > 0.0;
}

void PrismStrategy::update_extrema(const Bar& bar) {
    ext_bars_++;
    ext_h0_ = ext_h1_; ext_h1_ = ext_h2_; ext_h2_ = bar.high;
    ext_l0_ = ext_l1_; ext_l1_ = ext_l2_; ext_l2_ = bar.low;
    ext_rsi0_ = ext_rsi1_; ext_rsi1_ = ext_rsi2_; ext_rsi2_ = current_rsi_;
    ext_macd0_ = ext_macd1_; ext_macd1_ = ext_macd2_; ext_macd2_ = macd_line_;
    ext_hist0_ = ext_hist1_; ext_hist1_ = ext_hist2_; ext_hist2_ = macd_histogram_;

    if (ext_bars_ >= 3) {
        const uint64_t mid_idx = bars_processed_ - 1;
        if (ext_h1_ >= ext_h0_ && ext_h1_ >= ext_h2_) {
            peak1_ = peak2_;
            peak2_ = {ext_h1_, ext_rsi1_, ext_macd1_, ext_hist1_, mid_idx};
            peak_count_++;
        }
        if (ext_l1_ <= ext_l0_ && ext_l1_ <= ext_l2_) {
            trough1_ = trough2_;
            trough2_ = {ext_l1_, ext_rsi1_, ext_macd1_, ext_hist1_, mid_idx};
            trough_count_++;
        }
    }
}

bool PrismStrategy::has_two_top_bearish_rsi() const {
    if (peak_count_ < 2) return false;
    if (bars_processed_ - peak2_.bar_index > 60) return false;
    if (peak2_.bar_index <= peak1_.bar_index || peak2_.bar_index - peak1_.bar_index < 3) return false;
    const bool price_higher_or_equal = peak2_.price >= peak1_.price * 0.998;
    const bool rsi_lower = peak2_.rsi < peak1_.rsi - 1.0;
    const bool overbought_zone = (peak1_.rsi >= 60.0 || peak2_.rsi >= 60.0);
    return price_higher_or_equal && rsi_lower && overbought_zone;
}

bool PrismStrategy::has_two_bottom_bullish_rsi() const {
    if (trough_count_ < 2) return false;
    if (bars_processed_ - trough2_.bar_index > 60) return false;
    if (trough2_.bar_index <= trough1_.bar_index || trough2_.bar_index - trough1_.bar_index < 3) return false;
    const bool price_lower_or_equal = trough2_.price <= trough1_.price * 1.002;
    const bool rsi_higher = trough2_.rsi > trough1_.rsi + 1.0;
    const bool oversold_zone = (trough1_.rsi <= 40.0 || trough2_.rsi <= 40.0);
    return price_lower_or_equal && rsi_higher && oversold_zone;
}

bool PrismStrategy::has_two_top_bearish_macd() const {
    if (peak_count_ < 2) return false;
    if (bars_processed_ - peak2_.bar_index > 60) return false;
    if (peak2_.bar_index <= peak1_.bar_index || peak2_.bar_index - peak1_.bar_index < 3) return false;
    const bool price_higher_or_equal = peak2_.price >= peak1_.price * 0.998;
    const bool macd_lower = (peak2_.macd < peak1_.macd) || (peak2_.hist < peak1_.hist);
    return price_higher_or_equal && macd_lower;
}

bool PrismStrategy::has_two_bottom_bullish_macd() const {
    if (trough_count_ < 2) return false;
    if (bars_processed_ - trough2_.bar_index > 60) return false;
    if (trough2_.bar_index <= trough1_.bar_index || trough2_.bar_index - trough1_.bar_index < 3) return false;
    const bool price_lower_or_equal = trough2_.price <= trough1_.price * 1.002;
    const bool macd_higher = (trough2_.macd > trough1_.macd) || (trough2_.hist > trough1_.hist);
    return price_lower_or_equal && macd_higher;
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
