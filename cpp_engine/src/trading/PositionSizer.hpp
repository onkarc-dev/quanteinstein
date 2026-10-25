#pragma once
#include <algorithm>
#include <cmath>

class PositionSizer {
public:
    static double fixed_fractional(double equity, double risk_pct, double entry, double stop,
                                   double max_notional, double lot_step = 0.000001) {
        const double risk_per_unit = std::abs(entry - stop);
        if (equity <= 0.0 || risk_pct <= 0.0 || risk_per_unit <= 0.0 || entry <= 0.0) return 0.0;
        const double risk_amount = equity * risk_pct;
        const double qty_by_risk = risk_amount / risk_per_unit;
        const double qty_by_notional = max_notional / entry;
        double qty = std::min(qty_by_risk, qty_by_notional);
        if (lot_step > 0.0) qty = std::floor(qty / lot_step) * lot_step;
        return std::max(0.0, qty);
    }

    // Institutional Quant OS v3: Inverse Volatility / Risk Parity Position Sizing
    // w_i proportional to 1 / sigma_i, normalized across basket assets
    static double risk_parity_unit(double equity, double asset_realized_vol, double total_inv_vol_sum,
                                   double current_price, double max_asset_weight_pct = 0.25,
                                   double max_leverage_gross = 2.0, double lot_step = 0.000001) {
        if (equity <= 0.0 || asset_realized_vol <= 0.0 || total_inv_vol_sum <= 0.0 || current_price <= 0.0) {
            return 0.0;
        }
        const double raw_weight = (1.0 / asset_realized_vol) / total_inv_vol_sum;
        const double clamped_weight = std::min(raw_weight, max_asset_weight_pct);
        const double allocated_capital = equity * clamped_weight * max_leverage_gross;
        double qty = allocated_capital / current_price;
        if (lot_step > 0.0) qty = std::floor(qty / lot_step) * lot_step;
        return std::max(0.0, qty);
    }

    // Institutional Equal Weighting: w_i = 1 / N
    static double equal_weight_unit(double equity, int num_assets, double current_price,
                                    double max_leverage_gross = 1.0, double lot_step = 0.000001) {
        if (equity <= 0.0 || num_assets <= 0 || current_price <= 0.0) return 0.0;
        const double weight = 1.0 / static_cast<double>(num_assets);
        const double allocated_capital = equity * weight * max_leverage_gross;
        double qty = allocated_capital / current_price;
        if (lot_step > 0.0) qty = std::floor(qty / lot_step) * lot_step;
        return std::max(0.0, qty);
    }
};
