#pragma once
#include "OrderTypes.hpp"
#include "../storage/EventStore.hpp"
#include <algorithm>
#include <cmath>
#include <string>
#include <unordered_map>

struct RiskConfig {
    double starting_equity = 100000.0;
    double max_risk_per_trade_pct = 0.005;      // 0.5% equity per trade
    double max_symbol_notional = 25000.0;
    double max_gross_notional = 75000.0;
    double max_daily_loss = 2000.0;
    int max_open_positions = 6;
    int max_orders_per_minute = 120;
    // Institutional Quant OS v3: Prop-Firm Circuit Breakers
    double max_trailing_drawdown_pct = 0.08;    // 8.0% intraday peak trailing drawdown
    bool hard_breaker_enabled = true;
    int news_risk_embargo_minutes = 15;
};

struct RiskDecision {
    bool approved = false;
    std::string reason;
    double notional = 0.0;
};

class RiskManager {
public:
    explicit RiskManager(RiskConfig cfg = {}, EventStore* store = nullptr)
        : cfg_(cfg), equity_(cfg.starting_equity), peak_equity_(cfg.starting_equity), store_(store) {}

    void set_event_store(EventStore* store) { store_ = store; }

    RiskDecision validate(const OrderRequest& order, double reference_price,
                          const std::unordered_map<std::string, Position>& positions) {
        if (order.quantity <= 0.0) return publish(order, {false, "quantity must be positive", 0.0});
        if (reference_price <= 0.0) return publish(order, {false, "reference price invalid", 0.0});
        if (hard_breaker_tripped_ && !order.reduce_only) {
            return publish(order, {false, "prop-firm trailing drawdown floor breached: hard breaker active", 0.0});
        }
        if (daily_realized_pnl_ <= -std::abs(cfg_.max_daily_loss)) return publish(order, {false, "daily loss limit reached", 0.0});
        if (orders_this_minute_ >= cfg_.max_orders_per_minute) return publish(order, {false, "orders per minute limit reached", 0.0});

        const double current_qty = position_quantity(order.symbol, positions);
        const double signed_order_qty = signed_quantity(order.side, order.quantity);
        const double projected_qty = current_qty + signed_order_qty;
        const double order_notional = std::abs(order.quantity * reference_price);
        const double projected_symbol_notional = std::abs(projected_qty * reference_price);

        if (order.reduce_only) {
            if (is_flat(current_qty)) {
                return publish(order, {false, "reduce-only requires existing position", order_notional});
            }
            if (same_direction(current_qty, signed_order_qty)) {
                return publish(order, {false, "reduce-only cannot increase position", order_notional});
            }
            if (std::abs(signed_order_qty) > std::abs(current_qty) + kEps) {
                return publish(order, {false, "reduce-only cannot flip position", order_notional});
            }
        }

        if (projected_symbol_notional > cfg_.max_symbol_notional + kEps) {
            return publish(order, {false, "symbol notional limit exceeded", projected_symbol_notional});
        }

        const double projected_gross = gross_notional_after(order.symbol, projected_qty, reference_price, positions);
        if (projected_gross > cfg_.max_gross_notional + kEps) {
            return publish(order, {false, "gross notional limit exceeded", projected_gross});
        }

        const bool opens_new_position = is_flat(current_qty) && !is_flat(projected_qty);
        if (opens_new_position && open_position_count(positions) >= cfg_.max_open_positions) {
            return publish(order, {false, "max open positions reached", order_notional});
        }

        ++orders_this_minute_;
        return publish(order, {true, "approved", order_notional});
    }

    void reset_rate_window() { orders_this_minute_ = 0; }
    double max_risk_amount() const { return equity_ * cfg_.max_risk_per_trade_pct; }
    void on_realized_pnl(double pnl) {
        daily_realized_pnl_ += pnl;
        update_equity(equity_ + pnl);
    }
    void update_equity(double current_equity) {
        equity_ = current_equity;
        if (equity_ > peak_equity_) {
            peak_equity_ = equity_;
        }
        if (peak_equity_ > 0.0) {
            const double current_dd = (peak_equity_ - equity_) / peak_equity_;
            if (cfg_.hard_breaker_enabled && current_dd >= cfg_.max_trailing_drawdown_pct) {
                hard_breaker_tripped_ = true;
            }
        }
    }
    double equity() const { return equity_; }
    double peak_equity() const { return peak_equity_; }
    bool is_hard_breaker_tripped() const { return hard_breaker_tripped_; }
    void reset_hard_breaker() { hard_breaker_tripped_ = false; peak_equity_ = equity_; }
    double daily_realized_pnl() const { return daily_realized_pnl_; }
    double daily_loss_utilization() const { return std::abs(daily_realized_pnl_) / std::max(1.0, std::abs(cfg_.max_daily_loss)); }
    const RiskConfig& config() const { return cfg_; }

private:
    static constexpr double kEps = 1e-12;

    static bool is_flat(double qty) { return std::abs(qty) <= kEps; }

    static double signed_quantity(Side side, double quantity) {
        return (side == Side::BUY ? 1.0 : -1.0) * quantity;
    }

    static bool same_direction(double a, double b) {
        return (a > 0.0 && b > 0.0) || (a < 0.0 && b < 0.0);
    }

    static double position_quantity(const std::string& symbol,
                                    const std::unordered_map<std::string, Position>& positions) {
        const auto it = positions.find(symbol);
        return it == positions.end() ? 0.0 : it->second.quantity;
    }

    static int open_position_count(const std::unordered_map<std::string, Position>& positions) {
        int count = 0;
        for (const auto& kv : positions) {
            if (!is_flat(kv.second.quantity)) ++count;
        }
        return count;
    }

    static double gross_notional_after(const std::string& order_symbol, double projected_order_qty,
                                       double reference_price,
                                       const std::unordered_map<std::string, Position>& positions) {
        double gross = std::abs(projected_order_qty * reference_price);
        for (const auto& kv : positions) {
            if (kv.first == order_symbol) continue;
            gross += std::abs(kv.second.quantity * reference_price);
        }
        return gross;
    }

    RiskDecision publish(const OrderRequest& order, RiskDecision decision) const {
        if (store_) store_->risk_decision(order.symbol, decision.approved, decision.reason, decision.notional);
        return decision;
    }

    RiskConfig cfg_;
    double equity_ = 0.0;
    double peak_equity_ = 0.0;
    bool hard_breaker_tripped_ = false;
    double daily_realized_pnl_ = 0.0;
    int orders_this_minute_ = 0;
    EventStore* store_ = nullptr;
};
