"""Eventos de mercado com ciclo de vida causal.

Todo evento aqui é imutável e carrega ``EventTiming``. Mudança de estado
(confirmação, invalidação) **nunca** muta o objeto: produz um novo com
``supersedes`` apontando para o ``event_id`` anterior. Assim o histórico
confirmado é append-only e auditável.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

from .enums import (
    LiquidityPoolKind,
    Side,
    SourceKind,
    StructureEvent,
    SweepOutcome,
    Timeframe,
)
from .errors import ContractViolation
from .timing import EventTiming, ensure_utc

__all__ = [
    "DomainEvent",
    "MacroEvent",
    "SwingPoint",
    "LiquidityPool",
    "SweepEvent",
    "StructureSignal",
]


def _mk_id(prefix: str, *parts: Any) -> str:
    """Id determinístico: mesma entrada ⇒ mesmo id (reprodutibilidade)."""
    raw = "|".join(str(p) for p in parts)
    return f"{prefix}_{hashlib.sha256(raw.encode()).hexdigest()[:16]}"


@dataclass(frozen=True, slots=True)
class DomainEvent:
    """Campos comuns a todo evento auditável."""

    event_id: str
    timing: EventTiming
    #: ``event_id`` do registro que este substitui (invalidação/revisão).
    supersedes: str | None = None

    def superseded_by(self, new_id: str, at: datetime) -> DomainEvent:
        return replace(self, timing=self.timing.invalidate(at), supersedes=new_id)


@dataclass(frozen=True, slots=True)
class MacroEvent:
    """Evento de calendário macroeconômico.

    ``impact`` é uma classificação da fonte, não uma previsão do sistema.
    ``source`` identifica de onde veio; se o calendário não estiver disponível
    o Macro Engine devolve NOT_AVAILABLE — jamais uma lista vazia interpretada
    como "não há eventos".
    """

    event_id: str
    name: str
    scheduled_at: datetime
    impact: str  # "HIGH" | "MEDIUM" | "LOW" — vocabulário da fonte
    timing: EventTiming
    source: str = "unknown"
    country: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "scheduled_at", ensure_utc(self.scheduled_at))

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "name": self.name,
            "scheduled_at": self.scheduled_at.isoformat(),
            "impact": self.impact,
            "source": self.source,
            "country": self.country,
            "timing": self.timing.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class SwingPoint:
    """Pivô estrutural confirmado por ``lookback`` barras de cada lado.

    A confirmação exige ``lookback`` barras **posteriores** já fechadas: por
    isso ``timing.confirmed_at`` é o close da última barra da direita, não o
    da barra do pivô. Ignorar isso é o clássico repaint de swing points.
    """

    point_id: str
    timeframe: Timeframe
    is_high: bool
    price: float
    bar_close_time: datetime
    timing: EventTiming
    lookback: int = 2

    def __post_init__(self) -> None:
        object.__setattr__(self, "bar_close_time", ensure_utc(self.bar_close_time))

    @staticmethod
    def make(
        timeframe: Timeframe,
        is_high: bool,
        price: float,
        bar_close_time: datetime,
        confirmed_at: datetime,
        available_at: datetime,
        lookback: int,
    ) -> SwingPoint:
        return SwingPoint(
            point_id=_mk_id("swg", timeframe, is_high, price, bar_close_time.isoformat()),
            timeframe=timeframe,
            is_high=is_high,
            price=price,
            bar_close_time=bar_close_time,
            timing=EventTiming(
                detected_at=confirmed_at,
                confirmed_at=confirmed_at,
                available_at=available_at,
            ),
            lookback=lookback,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "point_id": self.point_id,
            "timeframe": str(self.timeframe),
            "is_high": self.is_high,
            "price": self.price,
            "bar_close_time": self.bar_close_time.isoformat(),
            "lookback": self.lookback,
            "timing": self.timing.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class LiquidityPool:
    """Nível onde é razoável supor concentração de stops/ordens em repouso.

    Importante: o sistema **não observa** stops. O pool é uma *inferência
    estrutural* sobre preço, portanto ``source`` é no mínimo ``DERIVED`` e,
    quando construído sem volume/book, ``PROXY`` com ``proxy_for`` declarado.
    """

    pool_id: str
    kind: LiquidityPoolKind
    price: float
    timeframe: Timeframe
    timing: EventTiming
    source: SourceKind = SourceKind.DERIVED
    proxy_for: str | None = None
    #: Quantos toques distintos formaram o nível (equal highs/lows).
    touch_count: int = 1
    #: Tolerância em ticks usada para agrupar toques.
    tolerance_ticks: float = 0.0
    supersedes: str | None = None

    def __post_init__(self) -> None:
        if self.source is SourceKind.PROXY and not self.proxy_for:
            raise ContractViolation("LiquidityPool PROXY exige proxy_for")

    @property
    def is_high_side(self) -> bool:
        return self.kind in (
            LiquidityPoolKind.PREV_DAY_HIGH,
            LiquidityPoolKind.SESSION_HIGH,
            LiquidityPoolKind.EQUAL_HIGHS,
            LiquidityPoolKind.SWING_HIGH,
        )

    @property
    def sweep_side(self) -> Side:
        """Lado da operação esperada **após** o sweep deste pool.

        Sweep de liquidez acima (highs) precede rotação vendedora ⇒ SHORT.
        """
        return Side.SHORT if self.is_high_side else Side.LONG

    def to_dict(self) -> dict[str, Any]:
        return {
            "pool_id": self.pool_id,
            "kind": str(self.kind),
            "price": self.price,
            "timeframe": str(self.timeframe),
            "source": str(self.source),
            "proxy_for": self.proxy_for,
            "touch_count": self.touch_count,
            "tolerance_ticks": self.tolerance_ticks,
            "supersedes": self.supersedes,
            "timing": self.timing.to_dict(),
        }

    @staticmethod
    def make(
        kind: LiquidityPoolKind,
        price: float,
        timeframe: Timeframe,
        detected_at: datetime,
        confirmed_at: datetime,
        available_at: datetime,
        source: SourceKind = SourceKind.DERIVED,
        proxy_for: str | None = None,
        touch_count: int = 1,
        tolerance_ticks: float = 0.0,
    ) -> LiquidityPool:
        return LiquidityPool(
            pool_id=_mk_id("pool", kind, price, timeframe, confirmed_at.isoformat()),
            kind=kind,
            price=price,
            timeframe=timeframe,
            timing=EventTiming(
                detected_at=detected_at,
                confirmed_at=confirmed_at,
                available_at=available_at,
            ),
            source=source,
            proxy_for=proxy_for,
            touch_count=touch_count,
            tolerance_ticks=tolerance_ticks,
        )


@dataclass(frozen=True, slots=True)
class SweepEvent:
    """Varredura de um pool de liquidez.

    Ciclo de vida:

    1. ``PENDING`` — o preço penetrou o pool na barra corrente. Detectado, não
       confirmado. ``timing.confirmed_at is None`` ⇒ invisível a features.
    2. ``REJECTED`` — a barra de confirmação fechou de volta do lado de origem.
       Confirmado no ``close_time`` dessa barra.
    3. ``ACCEPTED_THROUGH`` — o preço aceitou além do pool. Confirmado também,
       mas invalida o setup de reversão.

    Um ``SweepEvent`` nunca muda de estado in-place: ``confirm_as`` devolve um
    novo evento que ``supersedes`` o pendente.
    """

    sweep_id: str
    pool_id: str
    side: Side
    timeframe: Timeframe
    penetration_price: float
    penetration_ticks: float
    outcome: SweepOutcome
    timing: EventTiming
    trigger_bar_close_time: datetime
    confirmation_bar_close_time: datetime | None = None
    supersedes: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "trigger_bar_close_time", ensure_utc(self.trigger_bar_close_time)
        )
        if self.confirmation_bar_close_time is not None:
            object.__setattr__(
                self,
                "confirmation_bar_close_time",
                ensure_utc(self.confirmation_bar_close_time),
            )
        if self.outcome is SweepOutcome.PENDING and self.timing.is_confirmed:
            raise ContractViolation("sweep PENDING não pode ter confirmed_at")
        if self.outcome in (SweepOutcome.REJECTED, SweepOutcome.ACCEPTED_THROUGH):
            if not self.timing.is_confirmed:
                raise ContractViolation(
                    f"sweep {self.outcome} exige confirmed_at (barra de confirmação fechada)"
                )
        if self.penetration_ticks < 0:
            raise ContractViolation("penetration_ticks não pode ser negativo")

    def confirm_as(
        self,
        outcome: SweepOutcome,
        confirmation_bar_close_time: datetime,
        available_at: datetime,
    ) -> SweepEvent:
        """Produz o evento confirmado que substitui este pendente."""
        if outcome is SweepOutcome.PENDING:
            raise ContractViolation("confirm_as não aceita PENDING")
        confirmed_at = ensure_utc(confirmation_bar_close_time)
        new_timing = EventTiming(
            detected_at=self.timing.detected_at,
            confirmed_at=confirmed_at,
            available_at=ensure_utc(available_at),
        )
        return SweepEvent(
            sweep_id=_mk_id("swp", self.pool_id, outcome, confirmed_at.isoformat()),
            pool_id=self.pool_id,
            side=self.side,
            timeframe=self.timeframe,
            penetration_price=self.penetration_price,
            penetration_ticks=self.penetration_ticks,
            outcome=outcome,
            timing=new_timing,
            trigger_bar_close_time=self.trigger_bar_close_time,
            confirmation_bar_close_time=confirmed_at,
            supersedes=self.sweep_id,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "sweep_id": self.sweep_id,
            "pool_id": self.pool_id,
            "side": str(self.side),
            "timeframe": str(self.timeframe),
            "penetration_price": self.penetration_price,
            "penetration_ticks": self.penetration_ticks,
            "outcome": str(self.outcome),
            "trigger_bar_close_time": self.trigger_bar_close_time.isoformat(),
            "confirmation_bar_close_time": (
                self.confirmation_bar_close_time.isoformat()
                if self.confirmation_bar_close_time
                else None
            ),
            "supersedes": self.supersedes,
            "timing": self.timing.to_dict(),
        }

    @staticmethod
    def pending(
        pool: LiquidityPool,
        side: Side,
        timeframe: Timeframe,
        penetration_price: float,
        penetration_ticks: float,
        trigger_bar_close_time: datetime,
        detected_at: datetime,
    ) -> SweepEvent:
        detected = ensure_utc(detected_at)
        return SweepEvent(
            sweep_id=_mk_id(
                "swp", pool.pool_id, "PENDING", ensure_utc(trigger_bar_close_time).isoformat()
            ),
            pool_id=pool.pool_id,
            side=side,
            timeframe=timeframe,
            penetration_price=penetration_price,
            penetration_ticks=penetration_ticks,
            outcome=SweepOutcome.PENDING,
            timing=EventTiming(detected_at=detected, available_at=detected),
            trigger_bar_close_time=trigger_bar_close_time,
        )


@dataclass(frozen=True, slots=True)
class StructureSignal:
    """BOS/CHoCH confirmado por fechamento de barra.

    O sistema só reconhece rompimento estrutural por **fechamento**, nunca por
    penetração intrabarra: penetração é sweep, fechamento é estrutura.
    """

    signal_id: str
    timeframe: Timeframe
    event: StructureEvent
    reference_price: float
    break_price: float
    timing: EventTiming
    reference_point_id: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "signal_id": self.signal_id,
            "timeframe": str(self.timeframe),
            "event": str(self.event),
            "reference_price": self.reference_price,
            "break_price": self.break_price,
            "reference_point_id": self.reference_point_id,
            "evidence": self.evidence,
            "timing": self.timing.to_dict(),
        }

    @staticmethod
    def make(
        timeframe: Timeframe,
        event: StructureEvent,
        reference_price: float,
        break_price: float,
        confirmed_at: datetime,
        available_at: datetime,
        reference_point_id: str | None = None,
        evidence: dict[str, Any] | None = None,
    ) -> StructureSignal:
        confirmed = ensure_utc(confirmed_at)
        return StructureSignal(
            signal_id=_mk_id("str", timeframe, event, break_price, confirmed.isoformat()),
            timeframe=timeframe,
            event=event,
            reference_price=reference_price,
            break_price=break_price,
            timing=EventTiming(
                detected_at=confirmed,
                confirmed_at=confirmed,
                available_at=ensure_utc(available_at),
            ),
            reference_point_id=reference_point_id,
            evidence=evidence or {},
        )
