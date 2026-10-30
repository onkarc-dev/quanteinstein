from apps.api.app.services.friction_engine import (
    MicrostructureExecutionEngine,
    BarData,
)


def test_passive_limit_order_adverse_selection_and_queue():
    # Construct test bar: low 99.5, high 101.5, volume 500
    bar = BarData(
        open=100.0,
        high=101.5,
        low=99.5,
        close=100.8,
        volume=500.0,
    )

    # 1. Price not touched: BUY limit at 99.0 when low is 99.5
    filled, fill_price, penalty = MicrostructureExecutionEngine.simulate_passive_limit_order(
        limit_price=99.0,
        side="BUY",
        bar=bar,
    )
    assert not filled
    assert fill_price == 0.0
    assert penalty == 0.0

    # 2. Queue position barrier: bar volume 50 is less than simulated queue ahead (1000 * 0.35 = 350)
    thin_bar = BarData(
        open=100.0,
        high=101.5,
        low=99.5,
        close=100.8,
        volume=50.0,
    )
    filled, fill_price, penalty = MicrostructureExecutionEngine.simulate_passive_limit_order(
        limit_price=100.0,
        side="BUY",
        bar=thin_bar,
        historical_l2_depth=1000.0,
    )
    assert not filled

    # 3. Successful fill with adverse selection toxic flow drag
    # bar volume 500 > queue ahead 350, price touched (low 99.5 <= 100.0)
    filled, fill_price, penalty = MicrostructureExecutionEngine.simulate_passive_limit_order(
        limit_price=100.0,
        side="BUY",
        bar=bar,
        kappa=0.20,
        historical_l2_depth=1000.0,
    )
    assert filled
    assert penalty > 0.0
    # For a BUY, adverse selection shifts fill higher than limit price
    assert fill_price > 100.0

    # 4. SELL order adverse selection shifts fill lower than limit price
    filled_sell, fill_price_sell, penalty_sell = MicrostructureExecutionEngine.simulate_passive_limit_order(
        limit_price=101.0,
        side="SELL",
        bar=bar,
        kappa=0.20,
        historical_l2_depth=1000.0,
    )
    assert filled_sell
    assert penalty_sell > 0.0
    assert fill_price_sell < 101.0


def test_hard_to_borrow_negative_carry_simulation():
    notional = 100_000.0  # $100k short position

    # 1. GC (General Collateral) - 35 bps annualized
    gc_result = MicrostructureExecutionEngine.calculate_short_borrow_fee(
        notional_value=notional,
        days_held=10.0,
        borrow_tier="GC",
    )
    assert gc_result["annualized_rate_pct"] == 0.35
    assert not gc_result["is_htb"]
    expected_gc_fee = 100_000.0 * (0.0035 / 360.0) * 10.0
    assert abs(gc_result["borrow_cost"] - round(expected_gc_fee, 4)) < 0.01

    # 2. MODERATE_HTB - 8.5% annualized
    mod_result = MicrostructureExecutionEngine.calculate_short_borrow_fee(
        notional_value=notional,
        days_held=30.0,
        borrow_tier="MODERATE_HTB",
    )
    assert mod_result["annualized_rate_pct"] == 8.5
    assert mod_result["is_htb"]
    expected_mod_fee = 100_000.0 * (0.085 / 360.0) * 30.0
    assert abs(mod_result["borrow_cost"] - round(expected_mod_fee, 4)) < 0.01

    # 3. SEVERE_HTB - 35.0% annualized
    severe_result = MicrostructureExecutionEngine.calculate_short_borrow_fee(
        notional_value=notional,
        days_held=30.0,
        borrow_tier="SEVERE_HTB",
    )
    assert severe_result["annualized_rate_pct"] == 35.0
    assert severe_result["is_htb"]
    expected_severe_fee = 100_000.0 * (0.350 / 360.0) * 30.0
    assert abs(severe_result["borrow_cost"] - round(expected_severe_fee, 4)) < 0.01
