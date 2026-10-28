import pytest
from app.core.institutional_risk_gateway import InstitutionalRiskGateway, PreTradeRiskConfig


class TestInstitutionalRiskGateway:
    def test_single_order_notional_cap(self):
        gateway = InstitutionalRiskGateway()
        org_id = "hedge_fund_alpha"
        cfg = gateway.get_or_create_config(org_id)
        cfg.max_order_notional = 500_000.0  # $500k limit

        # Order below cap
        ok, reason, _ = gateway.validate_order(
            org_id=org_id,
            symbol="BTCUSDT",
            side="BUY",
            qty=5.0,
            price=60_000.0,
            bbo_price=60_000.0,
        )
        assert ok is True
        assert reason is None

        # Order exceeding cap ($600,000)
        ok_fail, reason_fail, _ = gateway.validate_order(
            org_id=org_id,
            symbol="BTCUSDT",
            side="BUY",
            qty=10.0,
            price=60_000.0,
            bbo_price=60_000.0,
        )
        assert ok_fail is False
        assert "exceeds single order limit" in reason_fail

    def test_price_collar_check(self):
        gateway = InstitutionalRiskGateway()
        org_id = "hedge_fund_beta"
        cfg = gateway.get_or_create_config(org_id)
        cfg.price_collar_pct = 0.03  # 3% maximum deviation

        # Limit order within collar (1.6% above BBO)
        ok, reason, _ = gateway.validate_order(
            org_id=org_id,
            symbol="ETHUSDT",
            side="BUY",
            qty=1.0,
            price=3050.0,
            bbo_price=3000.0,
            order_type="LIMIT",
        )
        assert ok is True

        # Limit order breaching collar (10% above BBO)
        ok_breach, reason_breach, _ = gateway.validate_order(
            org_id=org_id,
            symbol="ETHUSDT",
            side="BUY",
            qty=1.0,
            price=3300.0,
            bbo_price=3000.0,
            order_type="LIMIT",
        )
        assert ok_breach is False
        assert "Price collar breach" in reason_breach

    def test_kill_switch_activation(self):
        gateway = InstitutionalRiskGateway()
        org_id = "hedge_fund_gamma"

        gateway.set_kill_switch(org_id, True)

        ok, reason, _ = gateway.validate_order(
            org_id=org_id,
            symbol="SOLUSDT",
            side="BUY",
            qty=10.0,
            price=150.0,
            bbo_price=150.0,
        )
        assert ok is False
        assert "Hard Kill-Switch is active" in reason

        # Disarm kill switch
        gateway.set_kill_switch(org_id, False)
        ok_armed, _, _ = gateway.validate_order(
            org_id=org_id,
            symbol="SOLUSDT",
            side="BUY",
            qty=10.0,
            price=150.0,
            bbo_price=150.0,
        )
        assert ok_armed is True
