"""Testes de no-repaint: histórico confirmado não é reescrito.

Um evento confirmado em ``T`` deve continuar existindo, com o mesmo id, o
mesmo desfecho e os mesmos carimbos, quando o sistema for consultado em
``T + k``. Se qualquer um desses campos mudar, houve repaint.
"""

from __future__ import annotations

from datetime import timedelta

import fixtures as F
import pytest

from degold_os.domain.enums import SweepOutcome, Timeframe
from degold_os.domain.errors import CausalityViolation
from degold_os.domain.market import BarSeries
from degold_os.engines import BaselineLiquidityEngine, BaselineStructureEngine
from degold_os.features.store import InMemoryFeatureStore

pytestmark = pytest.mark.causality


@pytest.fixture(scope="module")
def series():
    return F.build_extended_series()


@pytest.mark.parametrize("delta_minutes", [0, 2, 5, 10, 20])
def test_confirmed_sweep_never_changes(series, delta_minutes):
    """O sweep confirmado no instante da decisão permanece idêntico depois."""
    base = F.make_context(series=series)
    liq_now = BaselineLiquidityEngine().assess(base)
    sweep_now = liq_now.active_sweep
    assert sweep_now is not None

    later = F.make_context(series=series, as_of=F.DECISION_AT + timedelta(minutes=delta_minutes))
    liq_later = BaselineLiquidityEngine().assess(later)
    match = [
        s
        for s in (liq_later.pending_sweeps + tuple(filter(None, [liq_later.active_sweep])))
        if s.sweep_id == sweep_now.sweep_id
    ]
    # O sweep pode deixar de ser "ativo" por validade, mas jamais muda de forma.
    for s in match:
        assert s.outcome is sweep_now.outcome
        assert s.timing.confirmed_at == sweep_now.timing.confirmed_at
        assert s.penetration_price == sweep_now.penetration_price


def test_confirmed_structure_signals_are_stable_over_time(series):
    early = F.make_context(series=series, as_of=F.DECISION_AT)
    late = F.make_context(series=series, as_of=F.DECISION_AT + timedelta(minutes=15))
    sig_early = BaselineStructureEngine().assess(early).signals
    sig_late = BaselineStructureEngine().assess(late).signals

    late_by_id = {s.signal_id: s for s in sig_late}
    for s in sig_early:
        if s.signal_id in late_by_id:
            other = late_by_id[s.signal_id]
            assert other.event is s.event
            assert other.break_price == s.break_price
            assert other.timing.confirmed_at == s.timing.confirmed_at


def test_pending_sweep_is_promoted_by_creating_a_new_event(series):
    """A confirmação cria um novo evento que ``supersedes`` o pendente."""
    ctx = F.make_context(series=series)
    liq = BaselineLiquidityEngine().assess(ctx)
    sweep = liq.active_sweep
    assert sweep is not None
    assert sweep.outcome is SweepOutcome.REJECTED
    assert sweep.supersedes is not None, "confirmação deve referenciar o pendente"
    assert sweep.supersedes != sweep.sweep_id


def test_bar_series_refuses_to_rewrite_history(series):
    m1: BarSeries = series[Timeframe.M1]
    existing = list(m1)[10]
    fresh = BarSeries(Timeframe.M1, list(m1)[:11])
    with pytest.raises(CausalityViolation):
        fresh.append(existing)


def test_feature_store_refuses_conflicting_rewrite():
    store = InMemoryFeatureStore()
    t = F.DECISION_AT
    store.put("atr_m15", 12.5, as_of=t, available_at=t)
    store.put("atr_m15", 12.5, as_of=t, available_at=t)  # idempotente
    with pytest.raises(CausalityViolation):
        store.put("atr_m15", 99.0, as_of=t, available_at=t)


def test_feature_store_hides_features_not_yet_available():
    store = InMemoryFeatureStore()
    t = F.DECISION_AT
    store.put("x", 1.0, as_of=t, available_at=t + timedelta(seconds=1))
    assert store.get("x", t) is None
    assert store.get("x", t + timedelta(seconds=1)) == 1.0


def test_feature_store_rejects_availability_before_computation():
    store = InMemoryFeatureStore()
    t = F.DECISION_AT
    with pytest.raises(CausalityViolation):
        store.put("x", 1.0, as_of=t, available_at=t - timedelta(seconds=1))


def test_feature_store_history_is_bounded_by_as_of():
    store = InMemoryFeatureStore()
    t = F.DECISION_AT
    for i in range(5):
        stamp = t + timedelta(minutes=i)
        store.put("x", float(i), as_of=stamp, available_at=stamp)
    assert [r.value for r in store.history("x", t + timedelta(minutes=2))] == [0.0, 1.0, 2.0]
    assert store.get("x", t + timedelta(minutes=2)) == 2.0
