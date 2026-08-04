"""Saídas tipadas dos engines (os "schemas de saída" internos).

Cada engine devolve exatamente um destes objetos. Regras comuns:

- Todos são imutáveis (``frozen=True``) e serializáveis por ``to_dict()``.
- Todos carregam ``notes`` (razões legíveis) e ``uses_proxy``.
- Nenhum campo numérico usa 0 como "não sei": ausência é ``None`` ou
  ``MissingMeasurement``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .enums import (
    AcceptanceVerdict,
    Confidence,
    DataQualityStatus,
    EdgeMaturityStage,
    FlowVerdict,
    MarketRegime,
    OrderType,
    PositionState,
    RiskBreach,
    SessionPhase,
    Side,
    StructureEvent,
    Timeframe,
    TimeInForce,
    TrendDirection,
    VolatilityRegime,
)
from .errors import ContractViolation
from .events import LiquidityPool, StructureSignal, SweepEvent
from .measurement import MaybeMeasurement
from .timing import ensure_utc

__all__ = [
    "DataQualityReport",
    "TimeframeHealth",
    "SessionState",
    "MacroAssessment",
    "RegimeAssessment",
    "StructureAssessment",
    "LiquidityAssessment",
    "AcceptanceAssessment",
    "FlowAssessment",
    "OrderIntent",
    "TradePlan",
    "RiskAssessment",
    "PositionAssessment",
    "MaturityAssessment",
]


def _m(x: MaybeMeasurement | None) -> Any:
    return x.to_dict() if x is not None else None


# ---------------------------------------------------------------------------
# G0 — Data Quality
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TimeframeHealth:
    timeframe: Timeframe
    bars_available: int
    #: Segundos entre ``as_of`` e o close da última barra confirmada.
    staleness_seconds: float | None
    gaps_detected: int
    duplicates_detected: int
    out_of_order_detected: int
    status: DataQualityStatus

    def to_dict(self) -> dict[str, Any]:
        return {
            "timeframe": str(self.timeframe),
            "bars_available": self.bars_available,
            "staleness_seconds": self.staleness_seconds,
            "gaps_detected": self.gaps_detected,
            "duplicates_detected": self.duplicates_detected,
            "out_of_order_detected": self.out_of_order_detected,
            "status": str(self.status),
        }


@dataclass(frozen=True, slots=True)
class DataQualityReport:
    status: DataQualityStatus
    per_timeframe: tuple[TimeframeHealth, ...]
    feed_staleness_seconds: float | None
    quote_available: bool
    notes: tuple[str, ...] = ()

    @property
    def is_usable(self) -> bool:
        return self.status in (DataQualityStatus.OK, DataQualityStatus.DEGRADED)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": str(self.status),
            "per_timeframe": [h.to_dict() for h in self.per_timeframe],
            "feed_staleness_seconds": self.feed_staleness_seconds,
            "quote_available": self.quote_available,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SessionState:
    phase: SessionPhase
    local_date: str
    seconds_into_phase: float | None
    seconds_to_phase_end: float | None
    is_tradable_window: bool
    timezone_name: str
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "phase": str(self.phase),
            "local_date": self.local_date,
            "seconds_into_phase": self.seconds_into_phase,
            "seconds_to_phase_end": self.seconds_to_phase_end,
            "is_tradable_window": self.is_tradable_window,
            "timezone_name": self.timezone_name,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G1 — Macro
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MacroAssessment:
    calendar_available: bool
    in_blackout: bool
    #: Evento que motivou o blackout, se houver.
    blocking_event_name: str | None
    seconds_to_next_high_impact: float | None
    events_considered: int
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "calendar_available": self.calendar_available,
            "in_blackout": self.in_blackout,
            "blocking_event_name": self.blocking_event_name,
            "seconds_to_next_high_impact": self.seconds_to_next_high_impact,
            "events_considered": self.events_considered,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G2 — Regime
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RegimeAssessment:
    regime: MarketRegime
    volatility: VolatilityRegime
    htf_direction: TrendDirection
    atr: MaybeMeasurement | None
    atr_percentile: MaybeMeasurement | None
    #: Timeframes efetivamente usados no cálculo.
    basis: tuple[Timeframe, ...] = ()
    confidence: Confidence = Confidence.UNKNOWN
    uses_proxy: bool = False
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "regime": str(self.regime),
            "volatility": str(self.volatility),
            "htf_direction": str(self.htf_direction),
            "atr": _m(self.atr),
            "atr_percentile": _m(self.atr_percentile),
            "basis": [str(t) for t in self.basis],
            "confidence": str(self.confidence),
            "uses_proxy": self.uses_proxy,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class StructureAssessment:
    timeframe: Timeframe
    last_event: StructureEvent
    direction: TrendDirection
    signals: tuple[StructureSignal, ...] = ()
    last_swing_high: float | None = None
    last_swing_low: float | None = None
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "timeframe": str(self.timeframe),
            "last_event": str(self.last_event),
            "direction": str(self.direction),
            "signals": [s.to_dict() for s in self.signals],
            "last_swing_high": self.last_swing_high,
            "last_swing_low": self.last_swing_low,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G3 — Liquidity
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LiquidityAssessment:
    pools: tuple[LiquidityPool, ...]
    #: Sweep confirmado mais recente e ainda relevante em ``as_of``.
    active_sweep: SweepEvent | None
    #: Sweeps detectados mas ainda não confirmados (nunca alimentam gates).
    pending_sweeps: tuple[SweepEvent, ...] = ()
    uses_proxy: bool = False
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "pools": [p.to_dict() for p in self.pools],
            "active_sweep": self.active_sweep.to_dict() if self.active_sweep else None,
            "pending_sweeps": [s.to_dict() for s in self.pending_sweeps],
            "uses_proxy": self.uses_proxy,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G4 — Acceptance / Interaction
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AcceptanceAssessment:
    verdict: AcceptanceVerdict
    #: Fração do tempo/barras aceitas além do nível (0..1), ou None.
    time_beyond_ratio: MaybeMeasurement | None
    close_back_inside: bool | None
    rejection_wick_ratio: MaybeMeasurement | None
    reference_price: float | None
    side: Side | None
    confidence: Confidence = Confidence.UNKNOWN
    uses_proxy: bool = False
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": str(self.verdict),
            "time_beyond_ratio": _m(self.time_beyond_ratio),
            "close_back_inside": self.close_back_inside,
            "rejection_wick_ratio": _m(self.rejection_wick_ratio),
            "reference_price": self.reference_price,
            "side": str(self.side) if self.side else None,
            "confidence": str(self.confidence),
            "uses_proxy": self.uses_proxy,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G5 — Flow
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FlowAssessment:
    """Fluxo de ordens.

    LIMITAÇÃO ESTRUTURAL: sem tick-by-tick com agressor ou book, *não existe*
    delta real. O baseline usa proxies de volume/velocidade e por isso o
    veredito máximo é ``SUPPORTIVE`` com ``uses_proxy=True``, o que o Gate G5
    rebaixa a ``CONDITIONAL`` — nunca ``PASS``.
    """

    verdict: FlowVerdict
    delta: MaybeMeasurement | None
    volume_ratio: MaybeMeasurement | None
    aggression_ratio: MaybeMeasurement | None
    uses_proxy: bool = True
    confidence: Confidence = Confidence.UNKNOWN
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": str(self.verdict),
            "delta": _m(self.delta),
            "volume_ratio": _m(self.volume_ratio),
            "aggression_ratio": _m(self.aggression_ratio),
            "uses_proxy": self.uses_proxy,
            "confidence": str(self.confidence),
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G6 — Execution
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class OrderIntent:
    """Intenção de ordem. Em v1 nunca é enviada a um broker real."""

    kind: str
    side: Side
    order_type: OrderType
    quantity: int
    price: float | None
    stop_price: float | None = None
    time_in_force: TimeInForce = TimeInForce.DAY
    client_tag: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "side": str(self.side),
            "order_type": str(self.order_type),
            "quantity": self.quantity,
            "price": self.price,
            "stop_price": self.stop_price,
            "time_in_force": str(self.time_in_force),
            "client_tag": self.client_tag,
        }


@dataclass(frozen=True, slots=True)
class TradePlan:
    """Plano completo e autocontido de uma operação candidata."""

    side: Side
    entry_price: float
    stop_price: float
    target_price: float
    quantity: int
    risk_points: float
    reward_points: float
    risk_money: float
    rr: float
    #: Custo estimado (spread + slippage assumido), em pontos.
    cost_points: MaybeMeasurement | None
    rr_net: float | None
    entry_intent: OrderIntent
    stop_intent: OrderIntent
    target_intent: OrderIntent
    valid_until: datetime | None = None
    invalidation_price: float | None = None
    notes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.quantity < 1:
            raise ContractViolation("quantity deve ser >= 1")
        if self.risk_points <= 0:
            raise ContractViolation("risk_points deve ser > 0")
        if self.side is Side.LONG and not (self.stop_price < self.entry_price < self.target_price):
            raise ContractViolation("geometria LONG inválida (stop < entry < target)")
        if self.side is Side.SHORT and not (
            self.target_price < self.entry_price < self.stop_price
        ):
            raise ContractViolation("geometria SHORT inválida (target < entry < stop)")
        if self.valid_until is not None:
            object.__setattr__(self, "valid_until", ensure_utc(self.valid_until))

    def to_dict(self) -> dict[str, Any]:
        return {
            "side": str(self.side),
            "entry_price": self.entry_price,
            "stop_price": self.stop_price,
            "target_price": self.target_price,
            "quantity": self.quantity,
            "risk_points": self.risk_points,
            "reward_points": self.reward_points,
            "risk_money": self.risk_money,
            "rr": self.rr,
            "cost_points": _m(self.cost_points),
            "rr_net": self.rr_net,
            "entry_intent": self.entry_intent.to_dict(),
            "stop_intent": self.stop_intent.to_dict(),
            "target_intent": self.target_intent.to_dict(),
            "valid_until": self.valid_until.isoformat() if self.valid_until else None,
            "invalidation_price": self.invalidation_price,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G7 — Risk
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    approved: bool
    breaches: tuple[RiskBreach, ...]
    risk_money: float | None
    risk_pct_of_equity: float | None
    remaining_daily_risk: float | None
    trades_taken_today: int | None
    account_state_known: bool = True
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "breaches": [str(b) for b in self.breaches],
            "risk_money": self.risk_money,
            "risk_pct_of_equity": self.risk_pct_of_equity,
            "remaining_daily_risk": self.remaining_daily_risk,
            "trades_taken_today": self.trades_taken_today,
            "account_state_known": self.account_state_known,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G8 — Position
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PositionAssessment:
    state: PositionState
    open_quantity: int
    open_side: Side | None
    allows_new_entry: bool
    state_known: bool = True
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": str(self.state),
            "open_quantity": self.open_quantity,
            "open_side": str(self.open_side) if self.open_side else None,
            "allows_new_entry": self.allows_new_entry,
            "state_known": self.state_known,
            "notes": list(self.notes),
        }


# ---------------------------------------------------------------------------
# G9 — Edge Maturity
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MaturityAssessment:
    """Estágio de maturidade do setup e evidências que o sustentam.

    ``historical_confidence`` é ``None`` até existir OOS **e** walk-forward.
    O campo é deliberadamente separado de qualquer "score": score é qualidade
    estrutural do sinal no instante; confiança histórica é estatística fora da
    amostra. Confundi-los é o erro que este modelo torna impossível.
    """

    setup_id: str
    stage: EdgeMaturityStage
    oos_completed: bool
    walk_forward_completed: bool
    sample_size: int | None
    historical_confidence: float | None
    evidence_ref: str | None = None
    notes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.historical_confidence is not None and not (
            self.oos_completed and self.walk_forward_completed
        ):
            raise ContractViolation(
                "historical_confidence só pode existir após OOS e walk-forward"
            )
        if self.historical_confidence is not None and not 0.0 <= self.historical_confidence <= 1.0:
            raise ContractViolation("historical_confidence fora de [0,1]")

    def to_dict(self) -> dict[str, Any]:
        return {
            "setup_id": self.setup_id,
            "stage": str(self.stage),
            "oos_completed": self.oos_completed,
            "walk_forward_completed": self.walk_forward_completed,
            "sample_size": self.sample_size,
            "historical_confidence": self.historical_confidence,
            "evidence_ref": self.evidence_ref,
            "notes": list(self.notes),
        }
