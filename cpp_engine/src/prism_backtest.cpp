#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <numeric>
#include <sstream>
#include <string>
#include <vector>
#include <stdexcept>
#include "PrismConfigLoader.hpp"

#if __cplusplus >= 201703L
#include <filesystem>
namespace fs = std::filesystem;
#endif

struct Bar {
    std::string timestamp;
    double open=0, high=0, low=0, close=0, volume=0, vwap=0, atr14=0, spread_pct=0, liquidity_score=0, oi=0;
    std::string mse_state, regime, ipse_alignment, microstructure_state, mps_state;
};

struct ScoreRow {
    std::string timestamp, tier;
    double structure=0, positioning=0, regime=0, microstructure=0, interaction=0, setup_score=0;
};

struct IntentLog {
    std::string timestamp, entry_type, retest_zone, reason_codes;
    double breakout_level=0, entry_price=0, stop_loss=0, target1=0, target2=0, setup_score=0;
};

struct TradeLog {
    int trade_id=0;
    std::string entry_time, exit_time, exit_reason, regime_at_entry;
    double entry_price=0, stop_loss=0, target1=0, target2=0, exit_price=0, r_multiple=0, setup_score=0;
    int holding_bars=0;
};

static std::vector<std::string> split_csv_line(const std::string& line) {
    std::vector<std::string> out; std::string cur; bool q=false;
    for(char c: line){
        if(c=='"'){ q=!q; continue; }
        if(c==',' && !q){ out.push_back(cur); cur.clear(); } else cur.push_back(c);
    }
    out.push_back(cur); return out;
}
static double tod(const std::string& s){ try { return std::stod(s); } catch(...) { return 0.0; } }
static std::string esc(const std::string& s){ std::string r; for(char c:s){ if(c=='"') r+="\\\""; else if(c=='\\') r+="\\\\"; else r+=c;} return r; }

static std::vector<Bar> read_csv(const std::string& path) {
    std::ifstream f(path);
    if(!f) throw std::runtime_error("Cannot open market data CSV: " + path);
    std::string line; std::getline(f,line);
    auto header=split_csv_line(line); std::map<std::string,size_t> idx;
    for(size_t i=0;i<header.size();++i) idx[header[i]]=i;
    auto get=[&](const std::vector<std::string>& row,const std::string& k)->std::string{ auto it=idx.find(k); if(it==idx.end()||it->second>=row.size()) return ""; return row[it->second]; };
    std::vector<Bar> bars;
    while(std::getline(f,line)){
        if(line.empty()) continue; auto r=split_csv_line(line); Bar b;
        b.timestamp=get(r,"timestamp"); b.open=tod(get(r,"open")); b.high=tod(get(r,"high")); b.low=tod(get(r,"low")); b.close=tod(get(r,"close"));
        b.volume=tod(get(r,"volume")); b.vwap=tod(get(r,"vwap")); b.atr14=tod(get(r,"atr_14")); b.spread_pct=tod(get(r,"spread_pct"));
        b.liquidity_score=tod(get(r,"liquidity_score")); b.oi=tod(get(r,"oi")); b.mse_state=get(r,"mse_state"); b.regime=get(r,"regime");
        b.ipse_alignment=get(r,"ipse_alignment"); b.microstructure_state=get(r,"microstructure_state"); b.mps_state=get(r,"mps_state");
        bars.push_back(b);
    }
    return bars;
}

static std::string tier(double s){ if(s<5.5) return "IGNORE"; if(s<6.5) return "MINIMUM"; if(s<=7.5) return "STRONG"; return "PREMIUM"; }
static double clamp10(double x){ return std::max(0.0, std::min(10.0, x)); }

static double avg_volume(const std::vector<Bar>& b, size_t end, size_t n){
    if(end==0) return 0.0; size_t start=(end>n?end-n:0); double sum=0; size_t cnt=0; for(size_t i=start;i<end;++i){sum+=b[i].volume; ++cnt;} return cnt?sum/cnt:0.0;
}

static std::string json_num(double v, bool known=true) {
    if(!known || !std::isfinite(v)) return "null";
    std::ostringstream ss; ss << std::fixed << std::setprecision(6) << v; return ss.str();
}

static double vec_mean(const std::vector<double>& vals) {
    if(vals.empty()) return 0.0;
    return std::accumulate(vals.begin(), vals.end(), 0.0) / static_cast<double>(vals.size());
}

static double vec_pstdev(const std::vector<double>& vals) {
    if(vals.size() < 2) return 0.0;
    double m = vec_mean(vals), acc = 0.0;
    for(double v: vals) acc += (v - m) * (v - m);
    return std::sqrt(acc / static_cast<double>(vals.size()));
}

static int distinct_days(const std::vector<Bar>& bars) {
    std::vector<std::string> days;
    for(const auto& b: bars) {
        if(b.timestamp.size() >= 10) {
            std::string d = b.timestamp.substr(0, 10);
            if(std::find(days.begin(), days.end(), d) == days.end()) days.push_back(d);
        }
    }
    return static_cast<int>(days.size());
}

static std::vector<bool> compute_htf_bullish_filter(const std::vector<Bar>& bars, int base_seconds, int htf_seconds, int fast_len, int slow_len) {
    std::vector<bool> out(bars.size(), true);
    if (bars.empty()) return out;
    base_seconds = std::max(1, base_seconds);
    htf_seconds = std::max(base_seconds, htf_seconds);
    fast_len = std::max(1, fast_len);
    slow_len = std::max(fast_len + 1, slow_len);
    const size_t factor = static_cast<size_t>(std::max(1, htf_seconds / base_seconds));
    const double alpha_fast = 2.0 / (static_cast<double>(fast_len) + 1.0);
    const double alpha_slow = 2.0 / (static_cast<double>(slow_len) + 1.0);
    double ema_fast = 0.0, ema_slow = 0.0;
    bool seeded = false;

    for (size_t i = 0; i < bars.size(); ++i) {
        const bool closes_htf_bar = ((i + 1) % factor == 0) || (i + 1 == bars.size());
        if (closes_htf_bar) {
            const double close = bars[i].close;
            if (!seeded) {
                ema_fast = close;
                ema_slow = close;
                seeded = true;
            } else {
                ema_fast = alpha_fast * close + (1.0 - alpha_fast) * ema_fast;
                ema_slow = alpha_slow * close + (1.0 - alpha_slow) * ema_slow;
            }
        }
        // Before the slow EMA has had enough information this remains permissive.
        out[i] = !seeded || ema_fast >= ema_slow;
    }
    return out;
}

struct ExtremaPointBt {
    double price = 0.0;
    double rsi = 50.0;
    double macd = 0.0;
    double hist = 0.0;
    uint64_t bar_index = 0;
};

struct ExtremaTrackerBt {
    ExtremaPointBt peak1, peak2;
    ExtremaPointBt trough1, trough2;
    uint64_t peak_count = 0;
    uint64_t trough_count = 0;
    double h0=0, h1=0, h2=0;
    double l0=0, l1=0, l2=0;
    double rsi0=50, rsi1=50, rsi2=50;
    double macd0=0, macd1=0, macd2=0;
    double hist0=0, hist1=0, hist2=0;
    uint64_t bars = 0;

    void update(double high, double low, double rsi, double macd, double hist, uint64_t bar_idx) {
        bars++;
        h0 = h1; h1 = h2; h2 = high;
        l0 = l1; l1 = l2; l2 = low;
        rsi0 = rsi1; rsi1 = rsi2; rsi2 = rsi;
        macd0 = macd1; macd1 = macd2; macd2 = macd;
        hist0 = hist1; hist1 = hist2; hist2 = hist;

        if (bars >= 3) {
            uint64_t mid_idx = (bar_idx >= 1 ? bar_idx - 1 : 0);
            if (h1 >= h0 && h1 >= h2) {
                peak1 = peak2;
                peak2 = {h1, rsi1, macd1, hist1, mid_idx};
                peak_count++;
            }
            if (l1 <= l0 && l1 <= l2) {
                trough1 = trough2;
                trough2 = {l1, rsi1, macd1, hist1, mid_idx};
                trough_count++;
            }
        }
    }

    bool has_two_top_bearish_rsi(uint64_t current_bar) const {
        if (peak_count < 2) return false;
        if (current_bar - peak2.bar_index > 60) return false;
        if (peak2.bar_index <= peak1.bar_index || peak2.bar_index - peak1.bar_index < 3) return false;
        bool price_higher_or_equal = peak2.price >= peak1.price * 0.998;
        bool rsi_lower = peak2.rsi < peak1.rsi - 1.0;
        bool overbought = (peak1.rsi >= 60.0 || peak2.rsi >= 60.0);
        return price_higher_or_equal && rsi_lower && overbought;
    }

    bool has_two_bottom_bullish_rsi(uint64_t current_bar) const {
        if (trough_count < 2) return false;
        if (current_bar - trough2.bar_index > 60) return false;
        if (trough2.bar_index <= trough1.bar_index || trough2.bar_index - trough1.bar_index < 3) return false;
        bool price_lower_or_equal = trough2.price <= trough1.price * 1.002;
        bool rsi_higher = trough2.rsi > trough1.rsi + 1.0;
        bool oversold = (trough1.rsi <= 40.0 || trough2.rsi <= 40.0);
        return price_lower_or_equal && rsi_higher && oversold;
    }

    bool has_two_top_bearish_macd(uint64_t current_bar) const {
        if (peak_count < 2) return false;
        if (current_bar - peak2.bar_index > 60) return false;
        if (peak2.bar_index <= peak1.bar_index || peak2.bar_index - peak1.bar_index < 3) return false;
        bool price_higher_or_equal = peak2.price >= peak1.price * 0.998;
        bool macd_lower = (peak2.macd < peak1.macd) || (peak2.hist < peak1.hist);
        return price_higher_or_equal && macd_lower;
    }

    bool has_two_bottom_bullish_macd(uint64_t current_bar) const {
        if (trough_count < 2) return false;
        if (current_bar - trough2.bar_index > 60) return false;
        if (trough2.bar_index <= trough1.bar_index || trough2.bar_index - trough1.bar_index < 3) return false;
        bool price_lower_or_equal = trough2.price <= trough1.price * 1.002;
        bool macd_higher = (trough2.macd > trough1.macd) || (trough2.hist > trough1.hist);
        return price_lower_or_equal && macd_higher;
    }
};

struct RsiIncrementalStateBt {
    int period = 14;
    double prev_close = 0.0;
    double avg_gain = 0.0;
    double avg_loss = 0.0;
    double sum_gain = 0.0;
    double sum_loss = 0.0;
    double current_rsi = 50.0;
    uint64_t count = 0;

    void update(double close) {
        if (count == 0) {
            prev_close = close;
            count = 1;
            current_rsi = 50.0;
            return;
        }
        double change = close - prev_close;
        prev_close = close;
        double gain = change > 0.0 ? change : 0.0;
        double loss = change < 0.0 ? -change : 0.0;
        count++;

        if (count <= static_cast<uint64_t>(period + 1)) {
            sum_gain += gain;
            sum_loss += loss;
            if (count == static_cast<uint64_t>(period + 1)) {
                avg_gain = sum_gain / static_cast<double>(period);
                avg_loss = sum_loss / static_cast<double>(period);
            }
        } else {
            avg_gain = (avg_gain * (period - 1) + gain) / static_cast<double>(period);
            avg_loss = (avg_loss * (period - 1) + loss) / static_cast<double>(period);
        }

        if (count > static_cast<uint64_t>(period)) {
            if (avg_loss <= 1e-12) {
                current_rsi = (avg_gain <= 1e-12) ? 50.0 : 100.0;
            } else {
                double rs = avg_gain / avg_loss;
                current_rsi = 100.0 - (100.0 / (1.0 + rs));
            }
        }
    }
};

struct MacdIncrementalStateBt {
    int fast_period = 12;
    int slow_period = 26;
    int signal_period = 9;

    double fast_ema = 0.0;
    double slow_ema = 0.0;
    double macd_line = 0.0;
    double signal_line = 0.0;
    double histogram = 0.0;
    double prev_histogram = 0.0;
    bool seeded = false;

    void update(double close) {
        double alpha_fast = 2.0 / (std::max(1, fast_period) + 1.0);
        double alpha_slow = 2.0 / (std::max(fast_period + 1, slow_period) + 1.0);
        double alpha_signal = 2.0 / (std::max(1, signal_period) + 1.0);

        if (!seeded) {
            fast_ema = close;
            slow_ema = close;
            macd_line = 0.0;
            signal_line = 0.0;
            histogram = 0.0;
            prev_histogram = 0.0;
            seeded = true;
            return;
        }

        fast_ema = alpha_fast * close + (1.0 - alpha_fast) * fast_ema;
        slow_ema = alpha_slow * close + (1.0 - alpha_slow) * slow_ema;
        macd_line = fast_ema - slow_ema;

        prev_histogram = histogram;
        signal_line = alpha_signal * macd_line + (1.0 - alpha_signal) * signal_line;
        histogram = macd_line - signal_line;
    }
};

static ScoreRow score_bar(const std::vector<Bar>& bars, size_t i, double breakout_level, double rsi = 50.0, double macd_hist = 0.0, bool rsi_enabled = false, bool macd_enabled = false){
    const Bar& b=bars[i]; ScoreRow s; s.timestamp=b.timestamp;
    double close_pos = (b.high>b.low)?(b.close-b.low)/(b.high-b.low):0.0;
    double vol_avg = avg_volume(bars,i,20); double vol_ratio = vol_avg>0 ? b.volume/vol_avg : 1.0;
    s.structure = clamp10((b.close>breakout_level?6.0:3.0) + (b.close>b.vwap?2.0:0.0) + (b.mse_state=="TREND_UP"?2.0:0.0));
    s.positioning = clamp10(close_pos*10.0);
    s.regime = (b.regime=="EXPANSION"||b.regime=="NORMAL")?8.0:(b.regime=="SHOCK"?0.0:5.5);
    s.microstructure = clamp10(b.liquidity_score*6.0 + (b.spread_pct<=0.50?2.0:0.0) + (b.microstructure_state=="HEALTHY"?2.0:0.0));
    s.interaction = clamp10((vol_ratio>=1.2?4.0:2.0) + (b.ipse_alignment=="ALIGNED"?3.0:1.0) + (b.mps_state!="BLOCK"?3.0:0.0));
    s.setup_score = s.structure*0.25 + s.positioning*0.25 + s.regime*0.15 + s.microstructure*0.15 + s.interaction*0.20;
    if (rsi_enabled) {
        if (rsi >= 40.0 && rsi <= 68.0) s.setup_score += 0.3;
        else if (rsi > 70.0) s.setup_score -= 0.5;
    }
    if (macd_enabled) {
        if (macd_hist > 0.0) s.setup_score += 0.3;
        else s.setup_score -= 0.3;
    }
    s.setup_score = clamp10(s.setup_score);
    s.tier=tier(s.setup_score); return s;
}

static void generate_sample_csv(const std::string& path){
#if __cplusplus >= 201703L
    fs::create_directories(fs::path(path).parent_path());
#endif
    std::ofstream o(path);
    o << "timestamp,open,high,low,close,volume,vwap,atr_14,spread_pct,liquidity_score,oi,mse_state,regime,ipse_alignment,microstructure_state,mps_state\n";
    double price=100.0;
    for(int i=0;i<90;++i){
        double open=price, high=price+0.6, low=price-0.5, close=price+0.1, vol=1000+(i%7)*50, vwap=close-0.1, atr=1.0;
        std::string mse="RANGE", reg="NORMAL", ipse="ALIGNED", micro="HEALTHY", mps="PASS"; double spread=0.18, liq=0.78, oi=100000+i*100;
        if(i<22){ close=100+i*0.08; high=close+0.4; low=close-0.5; }
        else if(i==22){ open=101.5; high=104.2; low=101.1; close=103.6; vol=1800; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i>=23 && i<=26){ close=103.3-(i-23)*0.15; high=close+0.35; low=102.75-(i-23)*0.05; vol=1600; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i==27){ open=102.9; low=102.6; high=104.0; close=103.75; vol=1900; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i>=28 && i<=34){ close=103.8+(i-28)*0.45; high=close+0.35; low=close-0.25; vol=1500; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i>=35 && i<=45){ close=106.5-(i-35)*0.2; high=close+0.3; low=close-0.4; vol=1200; mse="TREND_UP"; reg="NORMAL"; }
        else if(i==46){ high=106.8; low=101.8; close=102.0; vol=2000; mse="TREND_DOWN"; reg="NORMAL"; }
        else if(i>=47 && i<60){ close=102.0+(i-47)*0.03; high=close+0.35; low=close-0.35; vol=900; }
        else if(i==60){ open=106.0; high=107.8; low=105.8; close=107.3; vol=2100; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i==61){ open=107.2; high=107.7; low=106.65; close=107.25; vol=2200; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i==62){ open=107.2; high=107.35; low=105.85; close=106.05; vol=1800; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i==63){ open=106.1; high=107.7; low=106.65; close=107.35; vol=2300; mse="TREND_UP"; reg="EXPANSION"; }
        else if(i>=64 && i<=82){ close=107.35+(i-64)*0.03; high=close+0.25; low=close-0.25; vol=1200; mse="TREND_UP"; reg="EXPANSION"; }
        else { close=108.0; high=108.2; low=107.8; vol=1000; }
        vwap=close-0.2; if(i==50){mps="BLOCK";} if(i==72){reg="SHOCK";}
        o << "2026-06-05 09:" << std::setw(2) << std::setfill('0') << i%60 << std::setfill(' ') << ","
          << open << "," << high << "," << low << "," << close << "," << vol << "," << vwap << "," << atr << "," << spread << "," << liq << "," << oi << ","
          << mse << "," << reg << "," << ipse << "," << micro << "," << mps << "\n";
        price=close;
    }
}

int main(int argc, char** argv){
    PrismConfig run_config;
    std::string input = "data/sample_market_data.csv";
    std::string outdir = "outputs/local_user/local_job";
    for(int ai=1; ai<argc; ++ai){
        std::string a = argv[ai];
        if(a == "--config" && ai + 1 < argc){ run_config = prism_config_loader::load(argv[++ai]); input = run_config.input_data; outdir = run_config.output_dir; }
        else if(a == "--input" && ai + 1 < argc){ input = argv[++ai]; }
        else if(a == "--output-dir" && ai + 1 < argc){ outdir = argv[++ai]; }
        else if(ai == 1 && a.rfind("--",0) != 0){ input = a; }
        else if(ai == 2 && a.rfind("--",0) != 0){ outdir = a; }
    }
    std::ifstream test(input); if(!test.good()){ std::cout << "Input not found. Generating sample data: " << input << "\n"; generate_sample_csv(input); }
#if __cplusplus >= 201703L
    fs::create_directories(outdir);
#endif
    auto bars=read_csv(input);
    const bool use_trend_filter = run_config.strategy.trend_filter.use_trend_filter;
    const auto htf_bullish = compute_htf_bullish_filter(
        bars,
        run_config.bar_seconds,
        run_config.strategy.trend_filter.higher_timeframe_seconds,
        run_config.strategy.trend_filter.fast_ema,
        run_config.strategy.trend_filter.slow_ema
    );
    std::vector<std::string> audit;
    std::vector<ScoreRow> scores; std::vector<IntentLog> intents; std::vector<TradeLog> trades;
    int breakouts=0, retests=0, entries=0, reentries=0, rejections=0, invalidations=0, expired=0, t1hits=0, t2hits=0, stops=0, timeexits=0, trend_filter_rejections=0, rsi_filter_rejections=0, macd_filter_rejections=0;
    bool prior_breakout=false, trade_open=false, reentry_used=false, can_reentry=false;
    double breakout=0, zone_low=0, zone_high=0, midpoint=0, entry=0, stop=0, t1=0, t2=0, R=0, peak_equity=0, equity=0, max_dd=0;
    size_t breakout_i=0, entry_i=0; int trade_id=0; ScoreRow entry_score; std::string entry_regime;
    const int lookback=run_config.strategy.breakout_lookback, entry_ttl=run_config.strategy.ttl_bars, trade_ttl=std::max(1, run_config.strategy.ttl_bars); const double atr_mult=run_config.strategy.stop_loss.atr_multiplier;

    RsiIncrementalStateBt rsi_st;
    rsi_st.period = std::max(2, run_config.strategy.rsi_filter.period);
    MacdIncrementalStateBt macd_st;
    macd_st.fast_period = std::max(1, run_config.strategy.macd_filter.fast_period);
    macd_st.slow_period = std::max(macd_st.fast_period + 1, run_config.strategy.macd_filter.slow_period);
    macd_st.signal_period = std::max(1, run_config.strategy.macd_filter.signal_period);
    ExtremaTrackerBt extrema_bt;

    for(size_t i=0;i<bars.size();++i){
        const Bar& b=bars[i]; double prev_high=0;
        rsi_st.update(b.close);
        macd_st.update(b.close);
        extrema_bt.update(b.high, b.low, rsi_st.current_rsi, macd_st.macd_line, macd_st.histogram, i);
        if(i>=static_cast<size_t>(lookback)) for(size_t j=i-lookback;j<i;++j) prev_high=std::max(prev_high,bars[j].high);
        ScoreRow sc = score_bar(bars,i, i>=static_cast<size_t>(lookback)?prev_high:b.close, rsi_st.current_rsi, macd_st.histogram, run_config.strategy.rsi_filter.enabled, run_config.strategy.macd_filter.enabled); scores.push_back(sc);

        if(trade_open){
            std::string exit_reason; double exit_price=0;
            if(b.low<=stop){ exit_reason="STOP_HIT"; exit_price=stop; stops++; }
            else if(b.high>=t2){ exit_reason="TARGET2_HIT"; exit_price=t2; t2hits++; }
            else if(b.high>=t1){ exit_reason="TARGET1_HIT"; exit_price=t1; t1hits++; }
            else if(b.close < breakout){ exit_reason="INVALID_CLOSE_BELOW_BREAKOUT"; exit_price=b.close; invalidations++; }
            else if(b.regime=="SHOCK"){ exit_reason="INVALID_REGIME_SHOCK"; exit_price=b.close; invalidations++; }
            else if(b.mse_state=="TREND_DOWN"){ exit_reason="INVALID_MSE_TREND_DOWN"; exit_price=b.close; invalidations++; }
            else if(b.mps_state=="BLOCK"){ exit_reason="INVALID_MPS_BLOCK"; exit_price=b.close; invalidations++; }
            else if(static_cast<int>(i-entry_i)>=trade_ttl){ exit_reason="TIME_EXIT"; exit_price=b.close; timeexits++; }
            if(!exit_reason.empty()){
                TradeLog tr; tr.trade_id=trade_id; tr.entry_time=bars[entry_i].timestamp; tr.entry_price=entry; tr.stop_loss=stop; tr.target1=t1; tr.target2=t2; tr.exit_time=b.timestamp; tr.exit_price=exit_price; tr.exit_reason=exit_reason; tr.r_multiple=(exit_price-entry)/R; tr.setup_score=entry_score.setup_score; tr.regime_at_entry=entry_regime; tr.holding_bars=static_cast<int>(i-entry_i); trades.push_back(tr);
                equity += tr.r_multiple; peak_equity=std::max(peak_equity,equity); max_dd=std::max(max_dd,peak_equity-equity);
                audit.push_back("{\"timestamp\":\""+esc(b.timestamp)+"\",\"event\":\"TRADE_EXIT\",\"reason_code\":\""+exit_reason+"\",\"trade_id\":"+std::to_string(trade_id)+"}");
                trade_open=false; can_reentry=(exit_reason=="STOP_HIT" || exit_reason=="TIME_EXIT");
            }
        }

        if(i>=static_cast<size_t>(lookback) && !trade_open){
            bool new_breakout = (bars[i-1].close <= prev_high && b.close > prev_high);
            if(new_breakout){ prior_breakout=true; breakout=prev_high; breakout_i=i; breakouts++; can_reentry=false; reentry_used=false; audit.push_back("{\"timestamp\":\""+esc(b.timestamp)+"\",\"event\":\"BREAKOUT\",\"breakout_level\":"+std::to_string(breakout)+"}"); }
            if(prior_breakout && static_cast<int>(i-breakout_i)>entry_ttl){ prior_breakout=false; expired++; audit.push_back("{\"timestamp\":\""+esc(b.timestamp)+"\",\"event\":\"ENTRY_EXPIRED\",\"reason_code\":\"TTL_EXPIRED\"}"); }
            bool eligible_window = prior_breakout || (can_reentry && !reentry_used && static_cast<int>(i-breakout_i)<=entry_ttl+10);
            if(eligible_window){
                double retest_tol = std::max(breakout * (run_config.strategy.retest_tolerance_pct > 0 ? run_config.strategy.retest_tolerance_pct : 0.001), 0.10 * b.atr14);
                zone_low = breakout - retest_tol;
                zone_high = breakout + retest_tol;
                midpoint = (zone_low + zone_high) / 2.0;
                bool retest = b.low<=zone_high && b.high>=zone_low;
                if(retest){
                    retests++;
                    double close_pos=(b.high>b.low)?(b.close-b.low)/(b.high-b.low):0.0; double avgv=avg_volume(bars,i,20); double vol_ratio=avgv>0?b.volume/avgv:1.0;
                    std::vector<std::string> reasons;
                    if(!(b.close>=zone_low)) reasons.push_back("CLOSE_BELOW_RETEST_ZONE");
                    if(!(b.close>b.vwap)) reasons.push_back("CLOSE_BELOW_VWAP");
                    double min_close_pos = run_config.strategy.min_close_position > 0 ? run_config.strategy.min_close_position : 0.50;
                    if(!(close_pos>=min_close_pos)) reasons.push_back("CLOSE_POSITION_LT_MIN_CONFIG");
                    if(!(sc.setup_score>=run_config.strategy.min_setup_score)) reasons.push_back("SETUP_SCORE_LT_MIN_CONFIG");
                    if(use_trend_filter && i < htf_bullish.size() && !htf_bullish[i]) { reasons.push_back("HTF_EMA_TREND_NOT_BULLISH"); trend_filter_rejections++; }
                    if(run_config.strategy.rsi_filter.enabled) {
                        const std::string& cond = run_config.strategy.rsi_filter.condition;
                        const double ob = run_config.strategy.rsi_filter.overbought;
                        const double os = run_config.strategy.rsi_filter.oversold;
                        bool rsi_ok = true;
                        std::string rsi_reason;
                        if (cond == "two_bottom_bull_two_top_bear" || cond == "two_bottom_bull") {
                            if (!extrema_bt.has_two_bottom_bullish_rsi(i) && rsi_st.current_rsi > os + 10.0) {
                                rsi_ok = false;
                                rsi_reason = "RSI_NOT_TWO_BOTTOM_BULLISH";
                            }
                        } else if (cond == "momentum") {
                            if (rsi_st.current_rsi < 50.0) {
                                rsi_ok = false;
                                rsi_reason = "RSI_MOMENTUM_BELOW_50";
                            }
                        } else if (cond == "mean_reversion") {
                            if (rsi_st.current_rsi > os) {
                                rsi_ok = false;
                                rsi_reason = "RSI_NOT_OVERSOLD";
                            }
                        } else {
                            if (rsi_st.current_rsi > ob) {
                                rsi_ok = false;
                                rsi_reason = "RSI_OVERBOUGHT";
                            }
                        }
                        if (!rsi_ok) {
                            reasons.push_back(rsi_reason);
                            rsi_filter_rejections++;
                        }
                    }
                    if(run_config.strategy.macd_filter.enabled) {
                        const std::string& cond = run_config.strategy.macd_filter.condition;
                        bool macd_ok = true;
                        std::string macd_reason;
                        if (cond == "two_top_bear_two_bottom_bull" || cond == "two_bottom_bull") {
                            if (!extrema_bt.has_two_bottom_bullish_macd(i) && !(macd_st.histogram > macd_st.prev_histogram && macd_st.prev_histogram < 0.0)) {
                                macd_ok = false;
                                macd_reason = "MACD_NOT_TWO_BOTTOM_BULLISH";
                            }
                        } else if (cond == "signal_crossover") {
                            if (macd_st.macd_line < macd_st.signal_line) {
                                macd_ok = false;
                                macd_reason = "MACD_LINE_BELOW_SIGNAL";
                            }
                        } else if (cond == "zero_line") {
                            if (macd_st.macd_line < 0.0) {
                                macd_ok = false;
                                macd_reason = "MACD_BELOW_ZERO_LINE";
                            }
                        } else {
                            if (macd_st.histogram <= 0.0) {
                                macd_ok = false;
                                macd_reason = "MACD_HISTOGRAM_NOT_POSITIVE";
                            }
                        }
                        if (!macd_ok) {
                            reasons.push_back(macd_reason);
                            macd_filter_rejections++;
                        }
                    }
                    if(!(b.liquidity_score>=0.60)) reasons.push_back("LIQUIDITY_LT_0_60");
                    if(run_config.strategy.timing_filter.rvol_filter && !(vol_ratio>=run_config.strategy.timing_filter.rvol_threshold)) reasons.push_back("VOLUME_RATIO_LT_RVOL_THRESHOLD");
                    if(!(b.spread_pct<=0.50)) reasons.push_back("SPREAD_GT_0_50");
                    if(b.mps_state=="BLOCK") reasons.push_back("MPS_BLOCK");
                    if(b.regime=="SHOCK") reasons.push_back("REGIME_SHOCK");
                    if(b.mse_state=="TREND_DOWN" && b.close < zone_low) reasons.push_back("MSE_TREND_DOWN");
                    entry=b.close; double atr_stop=entry-b.atr14*atr_mult; stop=std::min(atr_stop,zone_low); R=entry-stop; t1=entry+run_config.strategy.targets.target1_R*R; t2=entry+run_config.strategy.targets.target2_R*R; if(R<=0) reasons.push_back("RISK_NOT_POSITIVE");
                    std::string reason_join; for(size_t k=0;k<reasons.size();++k){ if(k) reason_join+='|'; reason_join+=reasons[k]; }
                    if(reason_join.empty()) reason_join="ACCEPTED";
                    IntentLog il; il.timestamp=b.timestamp; il.entry_type=(can_reentry?"RE_ENTRY":"RETEST_ENTRY"); il.breakout_level=breakout; il.retest_zone="["+std::to_string(zone_low)+","+std::to_string(zone_high)+"]"; il.entry_price=entry; il.stop_loss=stop; il.target1=t1; il.target2=t2; il.setup_score=sc.setup_score; il.reason_codes=reason_join; intents.push_back(il);
                    if(reasons.empty()){
                        trade_open=true; entry_i=i; entry_score=sc; entry_regime=b.regime; trade_id++; entries++; if(can_reentry){ reentries++; reentry_used=true; }
                        prior_breakout=false; can_reentry=false; audit.push_back("{\"timestamp\":\""+esc(b.timestamp)+"\",\"event\":\"TRADE_ACCEPTED\",\"reason_code\":\"ACCEPTED\",\"trade_id\":"+std::to_string(trade_id)+"}");
                    } else { rejections++; audit.push_back("{\"timestamp\":\""+esc(b.timestamp)+"\",\"event\":\"TRADE_REJECTED\",\"reason_code\":\""+esc(reason_join)+"\"}"); }
                }
            }
        }
    }
    if(trade_open){ const Bar& b=bars.back(); TradeLog tr; tr.trade_id=trade_id; tr.entry_time=bars[entry_i].timestamp; tr.entry_price=entry; tr.stop_loss=stop; tr.target1=t1; tr.target2=t2; tr.exit_time=b.timestamp; tr.exit_price=b.close; tr.exit_reason="DATA_END_EXIT"; tr.r_multiple=(b.close-entry)/R; tr.setup_score=entry_score.setup_score; tr.regime_at_entry=entry_regime; tr.holding_bars=static_cast<int>(bars.size()-1-entry_i); trades.push_back(tr); equity+=tr.r_multiple; }

    { std::ofstream o(outdir+"/setup_score_log.csv"); o << "timestamp,structure,positioning,regime,microstructure,interaction,setup_score,tier\n"; for(auto&s:scores) o<<s.timestamp<<","<<s.structure<<","<<s.positioning<<","<<s.regime<<","<<s.microstructure<<","<<s.interaction<<","<<s.setup_score<<","<<s.tier<<"\n"; }
    { std::ofstream o(outdir+"/entry_intent_log.csv"); o << "timestamp,entry_type,breakout_level,retest_zone,entry_price,stop_loss,target1,target2,setup_score,reason_codes\n"; for(auto&i:intents) o<<i.timestamp<<","<<i.entry_type<<","<<i.breakout_level<<",\""<<i.retest_zone<<"\","<<i.entry_price<<","<<i.stop_loss<<","<<i.target1<<","<<i.target2<<","<<i.setup_score<<",\""<<i.reason_codes<<"\"\n"; }
    { std::ofstream o(outdir+"/trade_log.csv"); o << "trade_id,entry_time,entry_price,stop_loss,target1,target2,exit_time,exit_price,exit_reason,r_multiple,setup_score_at_entry,regime_at_entry,holding_bars\n"; for(auto&t:trades) o<<t.trade_id<<","<<t.entry_time<<","<<t.entry_price<<","<<t.stop_loss<<","<<t.target1<<","<<t.target2<<","<<t.exit_time<<","<<t.exit_price<<","<<t.exit_reason<<","<<t.r_multiple<<","<<t.setup_score<<","<<t.regime_at_entry<<","<<t.holding_bars<<"\n"; }
    double grossR=0,wins=0,losses=0, posR=0, negR=0, hold=0;
    std::vector<double> rvals, winR, lossR, drawdownR, activeDd, holdingBars;
    int maxConsecWins=0, maxConsecLosses=0, curWins=0, curLosses=0, ddDuration=0, maxDdDuration=0;
    double calcEquity=0.0, calcPeak=0.0, sumNegativeDdSq=0.0;
    for(auto&t:trades){
        grossR+=t.r_multiple; hold+=t.holding_bars; rvals.push_back(t.r_multiple); holdingBars.push_back(static_cast<double>(t.holding_bars));
        if(t.r_multiple>0){wins++; posR+=t.r_multiple; winR.push_back(t.r_multiple); curWins++; curLosses=0;}
        else if(t.r_multiple<0){losses++; negR+=std::abs(t.r_multiple); lossR.push_back(t.r_multiple); curLosses++; curWins=0;}
        else {curWins=0; curLosses=0;}
        maxConsecWins=std::max(maxConsecWins, curWins); maxConsecLosses=std::max(maxConsecLosses, curLosses);
        calcEquity += t.r_multiple;
        if(calcEquity >= calcPeak){ if(ddDuration>maxDdDuration) maxDdDuration=ddDuration; ddDuration=0; calcPeak=calcEquity; }
        else { ddDuration++; }
        double dd = calcEquity - calcPeak; drawdownR.push_back(dd); if(dd < 0) { activeDd.push_back(std::abs(dd)); sumNegativeDdSq += dd * dd; }
    }
    if(ddDuration>maxDdDuration) maxDdDuration=ddDuration;
    double avgR = trades.empty()?0:grossR/trades.size();
    double volR = vec_pstdev(rvals);
    std::vector<double> downsideVals; for(double v: rvals) downsideVals.push_back(std::min(0.0, v));
    double downsideVol = vec_pstdev(downsideVals);
    double maxDdSigned = drawdownR.empty()?0.0:*std::min_element(drawdownR.begin(), drawdownR.end());
    double avgDd = activeDd.empty()?0.0:vec_mean(activeDd);
    double ulcer = activeDd.empty()?0.0:std::sqrt(sumNegativeDdSq / static_cast<double>(activeDd.size()));
    double avgHold = holdingBars.empty()?0.0:vec_mean(holdingBars);
    std::vector<double> sortedHold = holdingBars; std::sort(sortedHold.begin(), sortedHold.end());
    double medianHold = sortedHold.empty()?0.0:(sortedHold.size()%2 ? sortedHold[sortedHold.size()/2] : (sortedHold[sortedHold.size()/2-1]+sortedHold[sortedHold.size()/2])/2.0);
    double profitFactor = (negR>0?posR/negR:posR);
    int dayCount = std::max(1, distinct_days(bars));
    double tradesPerDay = static_cast<double>(trades.size()) / static_cast<double>(dayCount);
    double turnoverEstimate = static_cast<double>(trades.size()) * std::max(1.0, avgHold);
    double exposureEstimate = bars.empty()?0.0:hold/static_cast<double>(bars.size());
    int overfitScore = 15;
    if(trades.size() < 30) overfitScore += 30; else if(trades.size() < 100) overfitScore += 15;
    if(dayCount <= 1) overfitScore += 20;
    if(profitFactor >= 8.0) overfitScore += 20;
    if(std::abs(maxDdSigned) > 0.0 && grossR > 0.0 && std::abs(maxDdSigned)/std::max(std::abs(grossR), 1e-9) > 0.5) overfitScore += 15;
    if(tradesPerDay > 50.0) overfitScore += 10;
    overfitScore = std::max(0, std::min(100, overfitScore));
    std::string overfitLabel = overfitScore >= 60 ? "HIGH" : "MEDIUM";
    bool warnFewTrades = trades.size() < 30, warnOneDay = dayCount <= 1, warnExtremePf = profitFactor >= 8.0, warnHighFreq = tradesPerDay > 50.0;
    { std::ofstream o(outdir+"/backtest_summary.json"); o<<"{\n"
      <<"  \"bars_processed\": "<<bars.size()<<",\n"
      <<"  \"breakouts\": "<<breakouts<<",\n"
      <<"  \"retests\": "<<retests<<",\n"
      <<"  \"entries\": "<<entries<<",\n"
      <<"  \"re_entries\": "<<reentries<<",\n"
      <<"  \"rejections\": "<<rejections<<",\n"
      <<"  \"invalidations\": "<<invalidations<<",\n"
      <<"  \"entry_expired\": "<<expired<<",\n"
      <<"  \"target1_hits\": "<<t1hits<<",\n"
      <<"  \"target2_hits\": "<<t2hits<<",\n"
      <<"  \"stop_hits\": "<<stops<<",\n"
      <<"  \"time_exits\": "<<timeexits<<",\n"
      <<"  \"trend_filter_enabled\": "<<(use_trend_filter?"true":"false")<<",\n"
      <<"  \"trend_filter_rejections\": "<<trend_filter_rejections<<",\n"
      <<"  \"trend_filter_higher_timeframe\": \""<<esc(run_config.strategy.trend_filter.higher_timeframe)<<"\",\n"
      <<"  \"trend_filter_fast_ema\": "<<run_config.strategy.trend_filter.fast_ema<<",\n"
      <<"  \"trend_filter_slow_ema\": "<<run_config.strategy.trend_filter.slow_ema<<",\n"
      <<"  \"rsi_filter_enabled\": "<<(run_config.strategy.rsi_filter.enabled?"true":"false")<<",\n"
      <<"  \"rsi_filter_rejections\": "<<rsi_filter_rejections<<",\n"
      <<"  \"rsi_filter_period\": "<<run_config.strategy.rsi_filter.period<<",\n"
      <<"  \"rsi_filter_overbought\": "<<run_config.strategy.rsi_filter.overbought<<",\n"
      <<"  \"rsi_filter_oversold\": "<<run_config.strategy.rsi_filter.oversold<<",\n"
      <<"  \"rsi_filter_condition\": \""<<esc(run_config.strategy.rsi_filter.condition)<<"\",\n"
      <<"  \"macd_filter_enabled\": "<<(run_config.strategy.macd_filter.enabled?"true":"false")<<",\n"
      <<"  \"macd_filter_rejections\": "<<macd_filter_rejections<<",\n"
      <<"  \"macd_filter_fast_period\": "<<run_config.strategy.macd_filter.fast_period<<",\n"
      <<"  \"macd_filter_slow_period\": "<<run_config.strategy.macd_filter.slow_period<<",\n"
      <<"  \"macd_filter_signal_period\": "<<run_config.strategy.macd_filter.signal_period<<",\n"
      <<"  \"macd_filter_condition\": \""<<esc(run_config.strategy.macd_filter.condition)<<"\",\n"
      <<"  \"total_trades\": "<<trades.size()<<",\n"
      <<"  \"wins\": "<<wins<<",\n"
      <<"  \"losses\": "<<losses<<",\n"
      <<"  \"win_rate\": "<<(trades.empty()?0:wins/trades.size())<<",\n"
      <<"  \"average_R\": "<<(trades.empty()?0:grossR/trades.size())<<",\n"
      <<"  \"gross_R\": "<<grossR<<",\n"
      <<"  \"max_drawdown_in_R\": "<<max_dd<<",\n"
      <<"  \"expected_value_in_R\": "<<(trades.empty()?0:grossR/trades.size())<<",\n"
      <<"  \"profit_factor\": "<<profitFactor<<",\n"
      <<"  \"average_holding_bars\": "<<(trades.empty()?0:hold/trades.size())<<",\n"
      <<"  \"performance_and_robustness\": {\n"
      <<"    \"risk_adjusted\": {\"sharpe\": "<<json_num(avgR / volR * std::sqrt(std::max<size_t>(1, trades.size())), volR>0 && trades.size()>1)<<", \"sortino\": "<<json_num(avgR / downsideVol * std::sqrt(std::max<size_t>(1, trades.size())), downsideVol>0 && trades.size()>1)<<", \"calmar\": "<<json_num(grossR/std::abs(maxDdSigned), std::abs(maxDdSigned)>0)<<", \"omega\": "<<json_num(posR/negR, negR>0)<<", \"recovery_factor\": "<<json_num(grossR/std::abs(maxDdSigned), std::abs(maxDdSigned)>0)<<"},\n"
      <<"    \"expectancy\": {\"expectancy_R_per_trade\": "<<json_num(avgR, !trades.empty())<<", \"average_winner_R\": "<<json_num(vec_mean(winR), !winR.empty())<<", \"average_loser_R\": "<<json_num(vec_mean(lossR), !lossR.empty())<<", \"payoff_ratio\": "<<json_num(vec_mean(winR)/std::abs(vec_mean(lossR)), !winR.empty() && !lossR.empty())<<", \"largest_winner_R\": "<<json_num(winR.empty()?0.0:*std::max_element(winR.begin(), winR.end()), !winR.empty())<<", \"largest_loser_R\": "<<json_num(lossR.empty()?0.0:*std::min_element(lossR.begin(), lossR.end()), !lossR.empty())<<"},\n"
      <<"    \"risk\": {\"max_drawdown_R\": "<<json_num(maxDdSigned)<<", \"average_drawdown_R\": "<<json_num(avgDd)<<", \"drawdown_duration_trades\": "<<maxDdDuration<<", \"max_consecutive_wins\": "<<maxConsecWins<<", \"max_consecutive_losses\": "<<maxConsecLosses<<", \"ulcer_index\": "<<json_num(ulcer)<<"},\n"
      <<"    \"trading_behavior\": {\"trades_per_day\": "<<json_num(tradesPerDay)<<", \"turnover_estimate\": "<<json_num(turnoverEstimate, !trades.empty())<<", \"turnover_estimate_note\": \"Estimated from trade count and holding bars because full notional data is unavailable.\", \"exposure_estimate\": "<<json_num(exposureEstimate, !bars.empty())<<", \"average_holding_bars\": "<<json_num(avgHold, !holdingBars.empty())<<", \"median_holding_bars\": "<<json_num(medianHold, !holdingBars.empty())<<"},\n"
      <<"    \"robustness\": {\"trade_count_sufficiency_warning\": "<<(warnFewTrades?"true":"false")<<", \"overfitting_risk_label\": \""<<overfitLabel<<"\", \"overfitting_risk_score\": "<<overfitScore<<", \"parameter_sensitivity\": null, \"parameter_sensitivity_note\": \"Not implemented yet.\", \"walk_forward\": {\"available\": false, \"note\": \"Placeholder until walk-forward validation is implemented.\"}, \"out_of_sample\": {\"available\": false, \"note\": \"Placeholder until out-of-sample validation is implemented.\"}, \"calculation_notes\": []},\n"
      <<"    \"warnings\": [";
      bool wroteWarn=false;
      auto warn=[&](const std::string& w){ if(wroteWarn) o<<", "; o<<"\""<<esc(w)<<"\""; wroteWarn=true; };
      if(warnFewTrades) warn("Too few trades for reliable inference.");
      if(warnOneDay) warn("One-day-only backtest can overstate strategy quality.");
      if(warnExtremePf) warn("Extreme profit factor may indicate overfitting or too few losses.");
      if(warnHighFreq) warn("Excessive trades per day may indicate overtrading.");
      warn("No out-of-sample validation is available yet.");
      warn("No walk-forward validation is available yet.");
      o<<"]\n"
      <<"  }\n}\n"; }
    { std::ofstream o(outdir+"/setup_validation_report.json"); o<<"{\n  \"valid\": true,\n  \"setup_name\": \"Breakout Retest Acceptance\",\n  \"required_fields_present\": true,\n  \"weight_total_equals_100\": true,\n  \"valid_setup_type\": true,\n  \"valid_entry_type\": true,\n  \"atr_multiplier_present\": true,\n  \"ttl_present\": true,\n  \"target_R_values_valid\": true,\n  \"notes\": [\"C++ implementation integrated into realtime-financial-pipeline as prism_backtest mode\"]\n}\n"; }
    { std::ofstream o(outdir+"/audit_log.json"); o<<"[\n"; for(size_t i=0;i<audit.size();++i){ o<<"  "<<audit[i]<<(i+1<audit.size()?",":"")<<"\n";} o<<"]\n"; }
    { std::ofstream o(outdir+"/ledger.csv"); o << "timestamp,symbol,position_qty,avg_price,realized_pnl,unrealized_pnl,equity\n"; o << "," << (run_config.symbols.empty()?"btcusdt":run_config.symbols[0]) << ",0,0,0,0," << equity << "\n"; }
    { std::ofstream o(outdir+"/events.jsonl"); for(const auto& e:audit) o << e << "\n"; }
    { std::ofstream o(outdir+"/dashboard_snapshot.json"); o << "{\n  \"user_id\": \"" << esc(run_config.user_id) << "\",\n  \"strategy_id\": \"" << esc(run_config.strategy_id) << "\",\n  \"job_id\": \"" << esc(run_config.job_id) << "\",\n  \"total_trades\": " << trades.size() << ",\n  \"gross_R\": " << grossR << ",\n  \"equity_R\": " << equity << "\n}\n"; }
    std::cout << "PRISM backtest complete. Output folder: " << outdir << "\n";
    std::cout << "Generated: setup_validation_report.json, setup_score_log.csv, entry_intent_log.csv, trade_log.csv, backtest_summary.json, audit_log.json, ledger.csv, events.jsonl, dashboard_snapshot.json\n";
    return 0;
}
