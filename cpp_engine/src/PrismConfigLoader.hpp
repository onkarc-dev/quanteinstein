#pragma once

#include "PrismConfig.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>

namespace prism_config_loader {

inline std::string read_file(const std::string& path) {
    std::ifstream in(path);
    if (!in.is_open()) {
        throw std::runtime_error("Cannot open PRISM config: " + path);
    }
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

inline std::string get_string(const std::string& json, const std::string& key, const std::string& fallback) {
    const std::regex rgx("\\\"" + key + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
    std::smatch m;
    if (std::regex_search(json, m, rgx)) return m[1].str();
    return fallback;
}

inline double get_double(const std::string& json, const std::string& key, double fallback) {
    const std::regex rgx("\\\"" + key + "\\\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
    std::smatch m;
    if (std::regex_search(json, m, rgx)) return std::stod(m[1].str());
    return fallback;
}

inline int get_int(const std::string& json, const std::string& key, int fallback) {
    return static_cast<int>(get_double(json, key, static_cast<double>(fallback)));
}

inline bool get_bool(const std::string& json, const std::string& key, bool fallback) {
    const std::regex rgx("\\\"" + key + "\\\"\\s*:\\s*(true|false)");
    std::smatch m;
    if (std::regex_search(json, m, rgx)) return m[1].str() == "true";
    return fallback;
}

inline std::vector<std::string> get_string_array(const std::string& json, const std::string& key, const std::vector<std::string>& fallback) {
    const std::regex rgx("\\\"" + key + "\\\"\\s*:\\s*\\[([^\\]]*)\\]");
    std::smatch m;
    if (!std::regex_search(json, m, rgx)) return fallback;
    std::string body = m[1].str();
    std::regex item_rgx("\\\"([^\\\"]*)\\\"");
    std::vector<std::string> out;
    for (std::sregex_iterator it(body.begin(), body.end(), item_rgx), end; it != end; ++it) {
        out.push_back((*it)[1].str());
    }
    return out.empty() ? fallback : out;
}

inline std::string lower_symbol(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c){ return static_cast<char>(std::tolower(c)); });
    return s;
}

inline PrismConfig load(const std::string& path) {
    const std::string json = read_file(path);
    PrismConfig c;
    c.user_id = get_string(json, "user_id", c.user_id);
    c.strategy_id = get_string(json, "strategy_id", c.strategy_id);
    c.job_id = get_string(json, "job_id", c.job_id);
    c.mode = get_string(json, "mode", c.mode);
    c.symbols = get_string_array(json, "symbols", c.symbols);
    for (auto& s : c.symbols) s = lower_symbol(s);
    c.timeframe = get_string(json, "timeframe", c.timeframe);
    c.bar_seconds = get_int(json, "bar_seconds", c.bar_seconds);

    c.strategy.name = get_string(json, "name", c.strategy.name);
    c.strategy.direction = get_string(json, "direction", c.strategy.direction);
    c.strategy.breakout_lookback = get_int(json, "breakout_lookback", c.strategy.breakout_lookback);
    c.strategy.retest_tolerance_pct = get_double(json, "retest_tolerance_pct", c.strategy.retest_tolerance_pct);
    c.strategy.min_setup_score = get_double(json, "min_setup_score", c.strategy.min_setup_score);
    c.strategy.max_retest_bars = get_int(json, "max_retest_bars", c.strategy.max_retest_bars);
    c.strategy.signal_cooldown_bars = get_int(json, "signal_cooldown_bars", c.strategy.signal_cooldown_bars);
    c.strategy.ttl_bars = get_int(json, "ttl_bars", c.strategy.ttl_bars);
    c.strategy.min_close_position = get_double(json, "min_close_position", c.strategy.min_close_position);
    c.strategy.stop_loss.type = get_string(json, "type", c.strategy.stop_loss.type);
    c.strategy.stop_loss.atr_multiplier = get_double(json, "atr_multiplier", c.strategy.stop_loss.atr_multiplier);
    c.strategy.stop_loss.structure_buffer_pct = get_double(json, "structure_buffer_pct", c.strategy.stop_loss.structure_buffer_pct);
    c.strategy.targets.target1_R = get_double(json, "target1_R", c.strategy.targets.target1_R);
    c.strategy.targets.target2_R = get_double(json, "target2_R", c.strategy.targets.target2_R);
    c.strategy.risk.risk_per_trade_pct = get_double(json, "risk_per_trade_pct", c.strategy.risk.risk_per_trade_pct);
    c.strategy.risk.max_daily_loss_pct = get_double(json, "max_daily_loss_pct", c.strategy.risk.max_daily_loss_pct);
    c.strategy.risk.max_open_positions = get_int(json, "max_open_positions", c.strategy.risk.max_open_positions);
    c.strategy.risk.max_symbol_notional = get_double(json, "max_symbol_notional", c.strategy.risk.max_symbol_notional);
    c.strategy.reentry.enabled = get_bool(json, "enabled", c.strategy.reentry.enabled);
    c.strategy.reentry.max_reentries = get_int(json, "max_reentries", c.strategy.reentry.max_reentries);
    c.strategy.reentry.cooldown_bars = get_int(json, "cooldown_bars", c.strategy.reentry.cooldown_bars);
    c.strategy.trend_filter.use_trend_filter = get_bool(json, "use_trend_filter", c.strategy.trend_filter.use_trend_filter);
    c.strategy.trend_filter.higher_timeframe = get_string(json, "higher_timeframe", c.strategy.trend_filter.higher_timeframe);
    c.strategy.trend_filter.higher_timeframe_seconds = get_int(json, "higher_timeframe_seconds", c.strategy.trend_filter.higher_timeframe_seconds);
    c.strategy.trend_filter.fast_ema = get_int(json, "fast_ema", c.strategy.trend_filter.fast_ema);
    c.strategy.trend_filter.slow_ema = get_int(json, "slow_ema", c.strategy.trend_filter.slow_ema);

    c.strategy.trade_management.breakeven_stop = get_bool(json, "breakeven_stop", c.strategy.trade_management.breakeven_stop);
    c.strategy.trade_management.partial_tp_pct = get_double(json, "partial_tp_pct", c.strategy.trade_management.partial_tp_pct);
    c.strategy.trade_management.trailing_stop = get_bool(json, "trailing_stop", c.strategy.trade_management.trailing_stop);
    c.strategy.trade_management.trailing_atr_multiplier = get_double(json, "trailing_atr_multiplier", c.strategy.trade_management.trailing_atr_multiplier);

    c.strategy.execution_friction.fee_pct = get_double(json, "fee_pct", c.strategy.execution_friction.fee_pct);
    c.strategy.execution_friction.slippage_pct = get_double(json, "slippage_pct", c.strategy.execution_friction.slippage_pct);

    c.strategy.timing_filter.trading_hours = get_string(json, "trading_hours", c.strategy.timing_filter.trading_hours);
    c.strategy.timing_filter.skip_weekends = get_bool(json, "skip_weekends", c.strategy.timing_filter.skip_weekends);
    c.strategy.timing_filter.rvol_filter = get_bool(json, "rvol_filter", c.strategy.timing_filter.rvol_filter);
    c.strategy.timing_filter.rvol_threshold = get_double(json, "rvol_threshold", c.strategy.timing_filter.rvol_threshold);

    c.input_data = get_string(json, "input_data", c.input_data);
    c.output_dir = get_string(json, "output_dir", c.output_dir);
    return c;
}

} // namespace prism_config_loader
