"""
apps/api/app/services/ast_evaluator.py
Institutional AST Condition Tree Evaluator (QuantOS v3.0).
Pure Python (zero external dependencies).
Implements:
1. Recursive JSON Rule Tree with AND, OR, NOT groups.
2. Cross-Asset Comparison: Asset A 20d Return > Asset B 20d Return.
3. Synthetic Spread & Cointegration: Spread_t = Price_A - beta * Price_B.
4. Rolling Z-Score: Z = (Spread_t - Mean_t) / StdDev_t.
5. Multi-Timeframe Confirmation: Macro HTF Trend (e.g. 4h EMA) + Execution LTF triggers (e.g. 5m).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple, Union


@dataclass
class SingleRule:
    left_operand: Any
    operator: str  # ">", ">=", "<", "<=", "==", "!="
    right_operand: Any


@dataclass
class RuleGroup:
    logical_operator: Literal["AND", "OR", "NOT"]
    children: List[Union[SingleRule, RuleGroup]] = field(default_factory=list)


@dataclass
class MultiTimeframeSnapshot:
    symbol: str
    timeframe: str
    indicators: Dict[str, float] = field(default_factory=dict)


class ASTConditionEvaluator:
    """Evaluates recursive AST rule trees and computes synthetic spread z-scores."""

    @staticmethod
    def compute_synthetic_spread(
        series_a: List[float],
        series_b: List[float],
        hedge_ratio: float = 1.0,
    ) -> List[float]:
        """Calculates synthetic spread: Spread_t = Price_A - (beta * Price_B)."""
        min_len = min(len(series_a), len(series_b))
        return [float(series_a[i]) - (hedge_ratio * float(series_b[i])) for i in range(min_len)]

    @staticmethod
    def compute_rolling_z_score(
        spread: List[float],
        lookback: int = 30,
    ) -> List[float]:
        """Calculates rolling Z-Score: Z_t = (Spread_t - Mean) / StdDev."""
        n = len(spread)
        if n == 0:
            return []
        win = max(2, int(lookback))
        z_scores = []

        for i in range(n):
            start_idx = max(0, i - win + 1)
            window = spread[start_idx : i + 1]
            if len(window) < 2:
                z_scores.append(0.0)
                continue
            mean = sum(window) / len(window)
            var = sum((x - mean) ** 2 for x in window) / (len(window) - 1)
            std = math.sqrt(var) if var > 1e-9 else 1.0
            z_scores.append((spread[i] - mean) / std)

        return z_scores

    @classmethod
    def compute_synthetic_spread_zscore(
        cls,
        series_a: List[float],
        series_b: List[float],
        lookback: int = 20,
    ) -> Tuple[float, List[float], List[float]]:
        """
        Calculates OLS hedge ratio (beta), synthetic spread, and rolling Z-score.
        OLS beta = Cov(A, B) / Var(B).
        """
        min_len = min(len(series_a), len(series_b))
        if min_len < 3:
            return 1.0, [], []

        a_slice = [float(x) for x in series_a[:min_len]]
        b_slice = [float(x) for x in series_b[:min_len]]

        mean_a = sum(a_slice) / min_len
        mean_b = sum(b_slice) / min_len

        cov = sum((a_slice[i] - mean_a) * (b_slice[i] - mean_b) for i in range(min_len))
        var_b = sum((b_slice[i] - mean_b) ** 2 for i in range(min_len))

        beta = (cov / var_b) if var_b > 1e-12 else 1.0
        spread = cls.compute_synthetic_spread(a_slice, b_slice, beta)
        zscore = cls.compute_rolling_z_score(spread, lookback=lookback)

        return round(beta, 4), spread, zscore

    @classmethod
    def _resolve_val(cls, operand: Any, market_data: Dict[str, Any]) -> float:
        if isinstance(operand, (int, float)):
            return float(operand)
        if isinstance(operand, str):
            # Check direct key in market_data
            if operand in market_data:
                try:
                    return float(market_data[operand])
                except (ValueError, TypeError):
                    pass
            # Try float conversion
            try:
                return float(operand)
            except ValueError:
                pass
        if isinstance(operand, dict):
            op_type = str(operand.get("type", "CONSTANT")).upper()
            if op_type == "CONSTANT":
                return float(operand.get("value", 0.0))
            if op_type == "INDICATOR":
                ind_name = str(operand.get("indicator", "close"))
                field = str(operand.get("field", "close"))
                for k in (f"{ind_name}_{field}", ind_name, field, "close"):
                    if k in market_data:
                        return float(market_data[k])
                return float(operand.get("value", 0.0))
        return 0.0

    @classmethod
    def evaluate_leaf(
        cls,
        rule: Union[SingleRule, Dict[str, Any]],
        market_data: Dict[str, Any],
    ) -> bool:
        """Evaluates single leaf condition against provided market data dictionary."""
        if isinstance(rule, SingleRule):
            left = cls._resolve_val(rule.left_operand, market_data)
            right = cls._resolve_val(rule.right_operand, market_data)
            op = rule.operator.strip()
        elif isinstance(rule, dict):
            left = cls._resolve_val(rule.get("left_operand") or rule.get("leftOperand"), market_data)
            right = cls._resolve_val(rule.get("right_operand") or rule.get("rightOperand") or rule.get("value"), market_data)
            op = str(rule.get("operator") or rule.get("comparisonOperator", "==")).strip()
        else:
            return False

        if op in (">", "GT"):
            return left > right
        if op in (">=", "GTE"):
            return left >= right
        if op in ("<", "LT"):
            return left < right
        if op in ("<=", "LTE"):
            return left <= right
        if op in ("==", "=", "EQ"):
            return abs(left - right) < 1e-9
        if op in ("!=", "<>", "NE"):
            return abs(left - right) >= 1e-9

        return False

    @classmethod
    def evaluate_group(
        cls,
        group: Union[RuleGroup, Dict[str, Any]],
        market_data: Dict[str, Any],
    ) -> bool:
        """Evaluates recursive RuleGroup boolean logic (AND, OR, NOT)."""
        if isinstance(group, RuleGroup):
            op = group.logical_operator.upper()
            children = group.children
        elif isinstance(group, dict):
            op = str(group.get("logical_operator") or group.get("operator", "AND")).upper()
            children = group.get("children", [])
        else:
            return False

        if not children:
            return True

        evaluated = []
        for child in children:
            if isinstance(child, RuleGroup) or (isinstance(child, dict) and (child.get("type") == "GROUP" or "children" in child)):
                evaluated.append(cls.evaluate_group(child, market_data))
            else:
                evaluated.append(cls.evaluate_leaf(child, market_data))

        if op == "AND":
            return all(evaluated)
        if op == "OR":
            return any(evaluated)
        if op == "NOT":
            return not all(evaluated)

        return all(evaluated)

    @classmethod
    def evaluate_rule_node(
        cls,
        node: Dict[str, Any],
        market_data: Dict[str, Any],
    ) -> bool:
        """Evaluates UI canvas node recursively."""
        node_type = str(node.get("type", "RULE")).upper()
        if node_type == "GROUP":
            return cls.evaluate_group(node, market_data)
        rule = node.get("rule", node)
        return cls.evaluate_leaf(rule, market_data)
