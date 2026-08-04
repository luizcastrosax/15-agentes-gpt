"""Testes de causalidade: nenhuma feature pode usar informação futura.

Estratégia: comparar a decisão tomada em ``T`` com dois conjuntos de dados que
diferem **apenas** no futuro de ``T``. Se a decisão, o plano ou qualquer
evidência mudar, existe look-ahead.

O prolongamento usado é adversarial: o preço dispara para cima logo após a
decisão, o que invalidaria o setup de reversão se o sistema o enxergasse.
"""

from __future__ import annotations

from datetime import timedelta

import fixtures as F
import pytest

from degold_os.contracts.context import EvaluationContext
from degold_os.domain.enums import Timeframe
from degold_os.domain.timing import AsOf
from degold_os.engines import (
    BaselineAcceptanceEngine,
    BaselineLiquidityEngine,
    BaselineRegimeEngine,
    BaselineStructureEngine,
)
from degold_os.features.indicators import atr, swing_points
from degold_os.orchestration.orchestrator import DecisionOrchestrator

pytestmark = pytest.mark.causality


@pytest.fixture(scope="module")
def base_series():
    return F.build_series()


@pytest.fixture(scope="module")
def extended_series():
    return F.build_extended_series()


def test_decision_is_identical_with_and_without_future_data(base_series, extended_series):
    a = DecisionOrchestrator().evaluate(F.make_context(series=base_series))
    b = DecisionOrchestrator().evaluate(F.make_context(series=extended_series))
    assert F.comparable(a) == F.comparable(b)


def test_inputs_digest_is_identical_with_and_without_future_data(
    base_series, extended_series
):
    a = DecisionOrchestrator().evaluate(F.make_context(series=base_series))
    b = DecisionOrchestrator().evaluate(F.make_context(series=extended_series))
    assert a.inputs_digest == b.inputs_digest


@pytest.mark.parametrize(
    "engine_name",
    ["regime", "structure", "liquidity", "acceptance"],
)
def test_each_engine_is_blind_to_the_future(base_series, extended_series, engine_name):
    ctx_a = F.make_context(series=base_series)
    ctx_b = F.make_context(series=extended_series)

    if engine_name == "regime":
        out_a = BaselineRegimeEngine().assess(ctx_a).to_dict()
        out_b = BaselineRegimeEngine().assess(ctx_b).to_dict()
    elif engine_name == "structure":
        out_a = BaselineStructureEngine().assess(ctx_a).to_dict()
        out_b = BaselineStructureEngine().assess(ctx_b).to_dict()
    elif engine_name == "liquidity":
        out_a = BaselineLiquidityEngine().assess(ctx_a).to_dict()
        out_b = BaselineLiquidityEngine().assess(ctx_b).to_dict()
    else:
        liq_a = BaselineLiquidityEngine().assess(ctx_a)
        liq_b = BaselineLiquidityEngine().assess(ctx_b)
        out_a = BaselineAcceptanceEngine().assess(ctx_a, liq_a).to_dict()
        out_b = BaselineAcceptanceEngine().assess(ctx_b, liq_b).to_dict()

    assert out_a == out_b, f"{engine_name} enxergou dados posteriores a as_of"


def test_snapshot_never_exposes_bars_after_as_of(extended_series):
    ctx = F.make_context(series=extended_series)
    for tf, series in ctx.snapshot.series.items():
        for bar in series:
            assert bar.timing.available_at <= ctx.now, (
                f"{tf}: barra com available_at posterior a as_of vazou para o snapshot"
            )


def test_forming_bar_is_never_used_by_features(base_series):
    """Uma decisão no meio de uma barra usa apenas a barra anterior fechada."""
    mid_bar = F.DECISION_AT - timedelta(seconds=30)  # dentro da barra 13:42-13:43
    ctx = F.make_context(series=base_series, as_of=mid_bar)
    closed = ctx.snapshot.closed(Timeframe.M1)
    assert closed, "deveria haver barras fechadas"
    assert all(b.close_time <= mid_bar for b in closed)
    forming = base_series[Timeframe.M1].forming_at(mid_bar)
    assert forming is not None
    assert forming.close_time > mid_bar
    assert forming not in closed


def test_atr_is_stable_when_future_bars_are_appended(base_series, extended_series):
    at = F.DECISION_AT
    a = atr(list(base_series[Timeframe.M15].closed_as_of(at)), 5)
    b = atr(list(extended_series[Timeframe.M15].closed_as_of(at)), 5)
    assert a is not None and b is not None
    assert a.value == pytest.approx(b.value)


def test_swing_points_do_not_repaint(base_series, extended_series):
    at = F.DECISION_AT
    bars_a = list(base_series[Timeframe.M2].closed_as_of(at))
    bars_b = list(extended_series[Timeframe.M2].closed_as_of(at))
    assert [b.close_time for b in bars_a] == [b.close_time for b in bars_b]
    highs_a, lows_a = swing_points(bars_a, 2)
    highs_b, lows_b = swing_points(bars_b, 2)
    assert highs_a == highs_b
    assert lows_a == lows_b


def test_pivots_confirmed_earlier_remain_pivots_later(base_series):
    """Um pivô confirmado em T continua confirmado em T+k, com o mesmo preço."""
    at = F.DECISION_AT
    earlier = at - timedelta(minutes=10)
    bars_early = list(base_series[Timeframe.M2].closed_as_of(earlier))
    bars_late = list(base_series[Timeframe.M2].closed_as_of(at))
    h_early, l_early = swing_points(bars_early, 2)
    h_late, l_late = swing_points(bars_late, 2)

    early_high_prices = [bars_early[i].high for i in h_early]
    late_high_prices = [bars_late[i].high for i in h_late]
    assert early_high_prices == late_high_prices[: len(early_high_prices)]

    early_low_prices = [bars_early[i].low for i in l_early]
    late_low_prices = [bars_late[i].low for i in l_late]
    assert early_low_prices == late_low_prices[: len(early_low_prices)]


def test_macro_event_published_after_as_of_is_invisible(base_series):
    from datetime import timedelta as _td

    from degold_os.domain.events import MacroEvent
    from degold_os.domain.timing import EventTiming

    published_later = F.DECISION_AT + _td(hours=1)
    event = MacroEvent(
        event_id="revisao_tardia",
        name="Evento adicionado ao calendário depois da decisão",
        scheduled_at=F.DECISION_AT + _td(minutes=5),
        impact="HIGH",
        timing=EventTiming.confirmed_now(published_later, published_later),
    )
    ctx = F.make_context(series=base_series, macro_events=(event,))
    visible = ctx.visible_macro_events()
    assert visible == (), "evento publicado após as_of não pode ser visível"


def test_as_of_is_the_only_temporal_input(base_series):
    """Duas avaliações do mesmo contexto são idênticas (sem relógio interno)."""
    ctx = F.make_context(series=base_series)
    orch = DecisionOrchestrator()
    a, b = orch.evaluate(ctx), orch.evaluate(ctx)
    assert F.comparable(a) == F.comparable(b)


def test_context_rejects_naive_as_of(base_series):
    from datetime import datetime

    from degold_os.domain.errors import CausalityViolation

    ctx = F.make_context(series=base_series)
    with pytest.raises(CausalityViolation):
        EvaluationContext(
            as_of=AsOf(datetime(2026, 6, 2, 13, 43)),
            snapshot=ctx.snapshot,
            config=ctx.config,
        )
