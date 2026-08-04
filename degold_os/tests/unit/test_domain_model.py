"""Modelos de domínio: medida, barra, série, plano e registro de decisão."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from degold_os.domain.assessments import OrderIntent, TradePlan
from degold_os.domain.decision import DecisionRecord, GateEvaluation, GateResult
from degold_os.domain.enums import (
    Decision,
    ExecutionMode,
    GateId,
    GateStatus,
    OrderType,
    SessionPhase,
    Side,
    SourceKind,
    Timeframe,
)
from degold_os.domain.errors import CausalityViolation, ContractViolation
from degold_os.domain.market import Bar, BarSeries, Instrument
from degold_os.domain.measurement import Measurement, MissingMeasurement, value_or_none
from degold_os.domain.timing import EventTiming

UTC = timezone.utc
T0 = datetime(2026, 6, 2, 13, 0, tzinfo=UTC)
MNQ = Instrument(symbol="MNQ", tick_size=0.25, point_value=2.0)


def _bar(minute: int, o=100.0, h=101.0, lo=99.0, c=100.5, vol=10.0) -> Bar:
    open_time = T0 + timedelta(minutes=minute)
    close_time = open_time + timedelta(minutes=1)
    return Bar(
        timeframe=Timeframe.M1,
        open_time=open_time,
        close_time=close_time,
        open=o,
        high=h,
        low=lo,
        close=c,
        volume=vol,
        timing=EventTiming.confirmed_now(close_time, close_time),
    )


# -- Measurement ------------------------------------------------------------


def test_proxy_requires_proxy_for():
    with pytest.raises(ContractViolation):
        Measurement(value=1.0, unit="ratio", source=SourceKind.PROXY)


def test_non_proxy_cannot_declare_proxy_for():
    with pytest.raises(ContractViolation):
        Measurement(
            value=1.0, unit="ratio", source=SourceKind.DERIVED, proxy_for="algo"
        )


def test_missing_measurement_is_not_zero():
    m = MissingMeasurement(reason="feed fora do ar", unit="points")
    assert value_or_none(m) is None
    assert m.to_dict()["value"] is None
    assert "reason" in m.to_dict()


def test_value_or_none_extracts_only_real_measurements():
    m = Measurement(value=3.0, unit="points", source=SourceKind.DERIVED)
    assert value_or_none(m) == 3.0
    assert value_or_none(None) is None


# -- Bar / BarSeries --------------------------------------------------------


def test_bar_rejects_incoherent_ohlc():
    with pytest.raises(ContractViolation):
        _bar(0, o=100.0, h=99.0, lo=98.0, c=98.5)


def test_bar_rejects_duration_mismatch():
    with pytest.raises(ContractViolation):
        Bar(
            timeframe=Timeframe.M5,
            open_time=T0,
            close_time=T0 + timedelta(minutes=1),
            open=1.0,
            high=1.0,
            low=1.0,
            close=1.0,
            volume=None,
            timing=EventTiming.confirmed_now(T0 + timedelta(minutes=1), T0 + timedelta(minutes=1)),
        )


def test_bar_cannot_be_confirmed_before_its_own_close():
    open_time, close_time = T0, T0 + timedelta(minutes=1)
    with pytest.raises(CausalityViolation):
        Bar(
            timeframe=Timeframe.M1,
            open_time=open_time,
            close_time=close_time,
            open=1.0,
            high=1.0,
            low=1.0,
            close=1.0,
            volume=None,
            timing=EventTiming(
                detected_at=open_time, confirmed_at=open_time, available_at=close_time
            ),
        )


def test_volume_none_is_absence_not_zero():
    b = _bar(0, vol=None)
    assert b.volume is None


def test_series_rejects_duplicate_and_out_of_order():
    s = BarSeries(Timeframe.M1, [_bar(0), _bar(1)])
    with pytest.raises(CausalityViolation):
        s.append(_bar(1))
    with pytest.raises(CausalityViolation):
        s.append(_bar(0))


def test_series_rejects_foreign_timeframe():
    s = BarSeries(Timeframe.M1)
    other = Bar(
        timeframe=Timeframe.M5,
        open_time=T0,
        close_time=T0 + timedelta(minutes=5),
        open=1.0,
        high=1.0,
        low=1.0,
        close=1.0,
        volume=None,
        timing=EventTiming.confirmed_now(T0 + timedelta(minutes=5), T0 + timedelta(minutes=5)),
    )
    with pytest.raises(ContractViolation):
        s.append(other)


def test_closed_as_of_excludes_bars_not_yet_available():
    s = BarSeries(Timeframe.M1, [_bar(0), _bar(1), _bar(2)])
    at = T0 + timedelta(minutes=2)  # a barra 1 (fecha 13:02) acabou de fechar
    closed = s.closed_as_of(at)
    assert [b.close_time for b in closed] == [
        T0 + timedelta(minutes=1),
        T0 + timedelta(minutes=2),
    ]


def test_forming_bar_is_not_in_closed_as_of():
    s = BarSeries(Timeframe.M1, [_bar(0), _bar(1)])
    at = T0 + timedelta(minutes=1, seconds=30)
    forming = s.forming_at(at)
    assert forming is not None
    assert forming not in s.closed_as_of(at)


def test_instrument_rounding_and_money():
    assert MNQ.round_to_tick(20993.83) == 20993.75
    assert MNQ.tick_value == 0.5
    assert MNQ.money(8.5, 2) == 34.0


# -- TradePlan --------------------------------------------------------------


def _intent(side: Side) -> OrderIntent:
    return OrderIntent(
        kind="ENTRY", side=side, order_type=OrderType.STOP, quantity=1, price=None
    )


def test_trade_plan_rejects_inverted_geometry():
    with pytest.raises(ContractViolation):
        TradePlan(
            side=Side.LONG,
            entry_price=100.0,
            stop_price=105.0,  # stop acima da entrada em um LONG
            target_price=110.0,
            quantity=1,
            risk_points=5.0,
            reward_points=10.0,
            risk_money=10.0,
            rr=2.0,
            cost_points=None,
            rr_net=1.8,
            entry_intent=_intent(Side.LONG),
            stop_intent=_intent(Side.SHORT),
            target_intent=_intent(Side.SHORT),
        )


# -- GateResult / DecisionRecord -------------------------------------------


def test_non_pass_gate_requires_reason():
    with pytest.raises(ContractViolation):
        GateResult(gate=GateId.G0_DATA, status=GateStatus.FAIL, reasons=())


def test_decision_record_refuses_live_order():
    with pytest.raises(ContractViolation):
        DecisionRecord(
            decision_id="x",
            as_of=T0,
            instrument="MNQ",
            execution_mode=ExecutionMode.SHADOW,
            session_phase=SessionPhase.NY_OPEN,
            decision=Decision.LIVE_ORDER,
            gates=GateEvaluation(()),
            trade_plan=None,
        )


def test_no_trade_cannot_carry_a_plan():
    with pytest.raises(ContractViolation):
        DecisionRecord(
            decision_id="x",
            as_of=T0,
            instrument="MNQ",
            execution_mode=ExecutionMode.SHADOW,
            session_phase=SessionPhase.NY_OPEN,
            decision=Decision.NO_TRADE,
            gates=GateEvaluation(()),
            trade_plan={"side": "SHORT"},
        )
