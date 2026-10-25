"""
apps/api/app/services/quant_universe.py
Institutional Dynamic Universe & Cross-Sectional Allocation Engine (QuantOS v3.0).
Implements:
1. Dynamic Universe Filtering (Volume/ADV, Realized Volatility, Sector/Asset Class categorization).
2. Portfolio-Level Weighting Math:
   - Equal Weighting: w_i = 1/N
   - Inverse Volatility / Risk Parity: w_i proportional to 1 / sigma_i, normalized to sum(|w_i|) = 1.0
   - Fixed Unit Sizing
3. Rebalancing Trigger Math (Daily Close, Weekly, or Drift Threshold > 5%).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional



@dataclass
class AssetMetadata:
    symbol: str
    asset_class: str  # "CRYPTO", "FOREX", "FUTURES", "EQUITY"
    adv_30d_usd: float
    realized_vol_20d: float  # Annualized
    sector: str = "GLOBAL"
    contract_size: float = 1.0
    tick_size: float = 0.01
    tick_value: float = 0.01
    margin_pct: float = 0.05

    @property
    def volume_24h(self) -> float:
        return self.adv_30d_usd

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "asset_class": self.asset_class,
            "adv_30d_usd": self.adv_30d_usd,
            "volume_24h": self.adv_30d_usd,
            "realized_vol_20d": self.realized_vol_20d,
            "sector": self.sector,
            "tick_size": self.tick_size,
            "tick_value": self.tick_value,
            "contract_size": self.contract_size,
        }


# Institutional default catalog for instant screening & paper/backtesting
DEFAULT_MARKET_CATALOG: List[AssetMetadata] = [
    # Top Binance Spot / Perps
    AssetMetadata("BTCUSDT", "CRYPTO", 28_000_000_000.0, 0.52, "Layer1", 1.0, 0.01, 0.01, 0.05),
    AssetMetadata("ETHUSDT", "CRYPTO", 14_000_000_000.0, 0.62, "Layer1", 1.0, 0.01, 0.01, 0.05),
    AssetMetadata("SOLUSDT", "CRYPTO", 5_500_000_000.0, 0.78, "Layer1", 1.0, 0.01, 0.01, 0.05),
    AssetMetadata("BNBUSDT", "CRYPTO", 1_200_000_000.0, 0.45, "Exchange", 1.0, 0.01, 0.01, 0.05),
    AssetMetadata("XRPUSDT", "CRYPTO", 2_100_000_000.0, 0.71, "Payments", 1.0, 0.0001, 0.0001, 0.05),
    AssetMetadata("DOGEUSDT", "CRYPTO", 1_800_000_000.0, 0.85, "Meme", 1.0, 0.00001, 0.00001, 0.05),
    AssetMetadata("ADAUSDT", "CRYPTO", 800_000_000.0, 0.68, "Layer1", 1.0, 0.0001, 0.0001, 0.05),
    AssetMetadata("AVAXUSDT", "CRYPTO", 750_000_000.0, 0.74, "Layer1", 1.0, 0.01, 0.01, 0.05),
    AssetMetadata("LINKUSDT", "CRYPTO", 650_000_000.0, 0.70, "Oracle", 1.0, 0.001, 0.001, 0.05),
    AssetMetadata("SUIUSDT", "CRYPTO", 950_000_000.0, 0.92, "Layer1", 1.0, 0.0001, 0.0001, 0.05),
    AssetMetadata("NEARUSDT", "CRYPTO", 600_000_000.0, 0.77, "AI_Layer1", 1.0, 0.001, 0.001, 0.05),
    AssetMetadata("FETUSDT", "CRYPTO", 480_000_000.0, 0.95, "AI", 1.0, 0.0001, 0.0001, 0.05),
    AssetMetadata("RENDERUSDT", "CRYPTO", 420_000_000.0, 0.88, "AI_Compute", 1.0, 0.001, 0.001, 0.05),
    AssetMetadata("PEPEUSDT", "CRYPTO", 1_100_000_000.0, 1.10, "Meme", 1.0, 0.0000001, 0.0000001, 0.05),
    AssetMetadata("TRXUSDT", "CRYPTO", 550_000_000.0, 0.38, "Layer1", 1.0, 0.00001, 0.00001, 0.05),
    AssetMetadata("DOTUSDT", "CRYPTO", 380_000_000.0, 0.64, "Layer0", 1.0, 0.001, 0.001, 0.05),
    AssetMetadata("LTCUSDT", "CRYPTO", 450_000_000.0, 0.55, "Payments", 1.0, 0.01, 0.01, 0.05),

    # CME Equity Index & Commodity Futures
    AssetMetadata("NQ", "FUTURES", 65_000_000_000.0, 0.18, "Index_Tech", 20.0, 0.25, 5.00, 0.08),
    AssetMetadata("ES", "FUTURES", 110_000_000_000.0, 0.14, "Index_Broad", 50.0, 0.25, 12.50, 0.05),
    AssetMetadata("YM", "FUTURES", 18_000_000_000.0, 0.13, "Index_BlueChip", 5.0, 1.00, 5.00, 0.05),
    AssetMetadata("RTY", "FUTURES", 14_000_000_000.0, 0.22, "Index_SmallCap", 50.0, 0.10, 5.00, 0.07),
    AssetMetadata("GC", "FUTURES", 42_000_000_000.0, 0.16, "Metals_Gold", 100.0, 0.10, 10.00, 0.06),

    # Global Forex Majors & Crosses
    AssetMetadata("EURUSD", "FOREX", 480_000_000_000.0, 0.07, "FX_Majors", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("GBPUSD", "FOREX", 220_000_000_000.0, 0.09, "FX_Majors", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("USDJPY", "FOREX", 310_000_000_000.0, 0.10, "FX_Majors", 100_000.0, 0.001, 1.00, 0.033),
    AssetMetadata("USDCHF", "FOREX", 95_000_000_000.0, 0.08, "FX_Majors", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("USDCAD", "FOREX", 115_000_000_000.0, 0.08, "FX_Majors", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("AUDUSD", "FOREX", 130_000_000_000.0, 0.11, "FX_Majors", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("NZDUSD", "FOREX", 65_000_000_000.0, 0.12, "FX_Majors", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("EURGBP", "FOREX", 90_000_000_000.0, 0.06, "FX_Crosses", 100_000.0, 0.00001, 1.00, 0.033),
    AssetMetadata("EURJPY", "FOREX", 125_000_000_000.0, 0.11, "FX_Crosses", 100_000.0, 0.001, 1.00, 0.033),
    AssetMetadata("GBPJPY", "FOREX", 140_000_000_000.0, 0.13, "FX_Crosses", 100_000.0, 0.001, 1.00, 0.033),
]


class UniverseFilterEngine:
    """Institutional Dynamic Universe Screener."""

    @classmethod
    def filter_universe(
        cls,
        catalog: Optional[Any] = None,
        asset_class: Optional[str] = None,
        min_adv_usd: float = 1_000_000.0,
        min_realized_vol_20d: float = 0.0,
        max_realized_vol_20d: float = 10.0,
        top_n_by_adv: Optional[int] = None,
        sectors: Optional[List[str]] = None,
    ) -> List[Any]:
        if isinstance(catalog, UniverseFilter):
            min_adv_usd = catalog.min_24h_volume
            max_realized_vol_20d = catalog.max_realized_volatility
            allowed_classes = [c.upper() for c in (catalog.asset_classes or [])]
            norm_sectors = [s.strip().upper() for s in (catalog.sectors or [])] if catalog.sectors else None
            top_n_by_adv = catalog.top_n
            assets = DEFAULT_MARKET_CATALOG
            matched = []
            for item in assets:
                if allowed_classes and item.asset_class.upper() not in allowed_classes:
                    continue
                if item.adv_30d_usd < min_adv_usd:
                    continue
                if not (min_realized_vol_20d <= item.realized_vol_20d <= max_realized_vol_20d):
                    continue
                if norm_sectors and item.sector.upper() not in norm_sectors:
                    continue
                matched.append(item)
            matched.sort(key=lambda x: x.adv_30d_usd, reverse=True)
            if top_n_by_adv and top_n_by_adv > 0:
                matched = matched[:top_n_by_adv]
            return matched

        assets = catalog or DEFAULT_MARKET_CATALOG
        matched = []

        norm_sectors = [s.strip().upper() for s in sectors] if sectors else None

        for item in assets:
            if asset_class and item.asset_class.upper() != asset_class.strip().upper():
                continue
            if item.adv_30d_usd < min_adv_usd:
                continue
            if not (min_realized_vol_20d <= item.realized_vol_20d <= max_realized_vol_20d):
                continue
            if norm_sectors and item.sector.upper() not in norm_sectors:
                continue

            matched.append(item)

        # Sort descending by 30-day ADV
        matched.sort(key=lambda x: x.adv_30d_usd, reverse=True)

        if top_n_by_adv and top_n_by_adv > 0:
            matched = matched[:top_n_by_adv]

        return [a.to_dict() for a in matched]



class CrossSectionalAllocationEngine:
    """Portfolio Allocation Math: Equal-Weight, Risk Parity (Inverse Vol), and Unit Risk."""

    @staticmethod
    def calculate_equal_weight(
        symbols: List[str],
        max_asset_weight_pct: float = 0.25,
    ) -> Dict[str, float]:
        """Equal weighting: w_i = 1/N, subject to max single-asset allocation clamp."""
        n = len(symbols)
        if n == 0:
            return {}
        raw = min(1.0 / n, max_asset_weight_pct)
        # Normalize sum(|w_i|) = 1.0
        norm = raw * n
        return {s: round(raw / norm, 6) for s in symbols}

    @staticmethod
    def calculate_risk_parity(
        volatility_map: Dict[str, float],
        max_asset_weight_pct: float = 1.0,
    ) -> Dict[str, float]:
        """
        Inverse Volatility Weighting (Risk Parity):
        w_i = (1 / sigma_i) / sum_j(1 / sigma_j)
        Each asset's weight is inversely proportional to its ATR or volatility.
        Supports iterative capping at max_asset_weight_pct with proper redistribution.
        """
        valid = {s: max(float(v), 1e-5) for s, v in volatility_map.items() if float(v) > 0}
        if not valid:
            return {}

        n = len(valid)
        cap = max(1.0 / n, min(1.0, max_asset_weight_pct))

        # Initial inverse vol weights
        inv = {s: 1.0 / sigma for s, sigma in valid.items()}
        sum_inv = sum(inv.values())
        weights = {s: v / sum_inv for s, v in inv.items()}

        if cap >= 0.9999:
            return {s: round(w, 6) for s, w in weights.items()}

        clamped = {}
        unclamped = dict(weights)

        while True:
            excess_syms = [s for s, w in unclamped.items() if w > cap + 1e-7]
            if not excess_syms:
                break
            for s in excess_syms:
                clamped[s] = cap
                del unclamped[s]

            if not unclamped:
                for s in valid:
                    clamped[s] = 1.0 / n
                break

            remaining_budget = max(0.0, 1.0 - sum(clamped.values()))
            unclamped_inv_sum = sum(inv[s] for s in unclamped)
            if unclamped_inv_sum > 0:
                for s in unclamped:
                    unclamped[s] = remaining_budget * (inv[s] / unclamped_inv_sum)

        final_weights = {**clamped, **unclamped}
        total = sum(final_weights.values())
        return {s: round(w / total, 6) for s, w in final_weights.items()}


    @staticmethod
    def calculate_fixed_unit_sizing(
        symbols: List[str],
        account_equity: float,
        risk_per_trade_pct: float = 1.0,
        stop_distances_pct: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Dict[str, float]]:
        """Calculates exact unit position sizes and dollar allocations based on stop distance."""
        stop_map = stop_distances_pct or {}
        risk_budget = account_equity * (risk_per_trade_pct / 100.0)
        allocations = {}

        for sym in symbols:
            stop_dist = max(float(stop_map.get(sym, 1.5)), 0.1) / 100.0  # default 1.5% stop
            position_notional = risk_budget / stop_dist
            allocations[sym] = {
                "risk_dollars": round(risk_budget, 2),
                "target_notional": round(position_notional, 2),
                "weight_pct": round(min(1.0, position_notional / max(1.0, account_equity)), 4),
            }

        return allocations

    @staticmethod
    def check_drift_rebalance_trigger(
        target_weights: Dict[str, float],
        current_weights: Dict[str, float],
        threshold_pct: float = 0.05,
    ) -> Dict[str, Any]:
        """
        Calculates portfolio weight drift: sum(|w_target - w_current|).
        Returns whether rebalancing is triggered.
        """
        all_syms = set(target_weights.keys()) | set(current_weights.keys())
        diffs = {s: abs(target_weights.get(s, 0.0) - current_weights.get(s, 0.0)) for s in all_syms}
        total_drift = sum(diffs.values())
        triggered = total_drift >= threshold_pct

        return {
            "triggered": triggered,
            "total_drift_pct": round(total_drift * 100.0, 2),
            "threshold_pct": round(threshold_pct * 100.0, 2),
            "asset_drifts": {s: round(v * 100.0, 2) for s, v in diffs.items()},
        }

    # Institutional method aliases
    equal_weight = calculate_equal_weight
    inverse_volatility_risk_parity = calculate_risk_parity
    fixed_unit_risk = calculate_fixed_unit_sizing

    @classmethod
    def check_rebalance_trigger(
        cls,
        target_weights: Dict[str, float],
        current_weights: Dict[str, float],
        config: Optional[Any] = None,
    ) -> bool:
        threshold = 0.05
        if config is not None:
            if hasattr(config, "drift_threshold"):
                threshold = config.drift_threshold
            elif isinstance(config, dict):
                threshold = config.get("drift_threshold", 0.05)
        res = cls.check_drift_rebalance_trigger(target_weights, current_weights, threshold)
        return bool(res["triggered"])


@dataclass
class UniverseFilter:
    min_24h_volume: float = 1_000_000.0
    max_realized_volatility: float = 10.0
    asset_classes: Optional[List[str]] = None
    sectors: Optional[List[str]] = None
    top_n: Optional[int] = None


@dataclass
class RebalanceTriggerConfig:
    drift_threshold: float = 0.05
    rebalance_interval: str = "DAILY_CLOSE"

