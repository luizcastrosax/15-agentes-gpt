"""Primitivas temporais causais.

Todo fato do sistema carrega quatro marcas de tempo:

``detected_at``
    Instante em que o sistema *percebeu* o fato pela primeira vez. Pode ser
    anterior à confirmação (ex.: sweep em barra ainda aberta).
``confirmed_at``
    Instante em que o fato deixou de ser provisório (ex.: fechamento da barra
    de confirmação). ``None`` = ainda não confirmado.
``available_at``
    Instante a partir do qual o fato pode ser *usado* por qualquer feature ou
    gate. É sempre ``>= confirmed_at`` e inclui a latência de ingestão.
    Este é o único carimbo consultado pelas queries as-of.
``invalidated_at``
    Instante em que o fato deixou de ser válido. Invalidação nunca apaga o
    fato: cria-se um novo registro com ``supersedes`` apontando para o antigo.

Regra de ouro (no-repaint): uma feature calculada em ``as_of = T`` só pode
enxergar fatos com ``available_at <= T`` e ``(invalidated_at is None or
invalidated_at > T)``. Isso é verificado em runtime por ``visible_at`` e
coberto pelos testes de causalidade.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

from .errors import CausalityViolation

__all__ = [
    "UTC",
    "ensure_utc",
    "EventTiming",
    "AsOf",
]

UTC = timezone.utc


def ensure_utc(ts: datetime) -> datetime:
    """Normaliza para UTC e recusa datetimes naive.

    Datetime naive é ambiguidade de fuso, e ambiguidade de fuso em um sistema
    causal é *look-ahead silencioso*. Portanto é erro, não warning.
    """
    if ts.tzinfo is None:
        raise CausalityViolation(
            f"datetime naive não é aceito: {ts!r}. Use timezone-aware (UTC)."
        )
    return ts.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class EventTiming:
    """Carimbos causais obrigatórios de qualquer evento do sistema."""

    detected_at: datetime
    available_at: datetime
    confirmed_at: datetime | None = None
    invalidated_at: datetime | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "detected_at", ensure_utc(self.detected_at))
        object.__setattr__(self, "available_at", ensure_utc(self.available_at))
        if self.confirmed_at is not None:
            object.__setattr__(self, "confirmed_at", ensure_utc(self.confirmed_at))
        if self.invalidated_at is not None:
            object.__setattr__(self, "invalidated_at", ensure_utc(self.invalidated_at))

        if self.confirmed_at is not None and self.confirmed_at < self.detected_at:
            raise CausalityViolation(
                "confirmed_at não pode ser anterior a detected_at "
                f"({self.confirmed_at.isoformat()} < {self.detected_at.isoformat()})"
            )
        if self.available_at < self.detected_at:
            raise CausalityViolation(
                "available_at não pode ser anterior a detected_at "
                f"({self.available_at.isoformat()} < {self.detected_at.isoformat()})"
            )
        if self.confirmed_at is not None and self.available_at < self.confirmed_at:
            raise CausalityViolation(
                "available_at não pode ser anterior a confirmed_at "
                f"({self.available_at.isoformat()} < {self.confirmed_at.isoformat()})"
            )
        if self.invalidated_at is not None and self.invalidated_at < self.available_at:
            raise CausalityViolation(
                "invalidated_at não pode ser anterior a available_at "
                f"({self.invalidated_at.isoformat()} < {self.available_at.isoformat()})"
            )

    # -- consultas ---------------------------------------------------------

    @property
    def is_confirmed(self) -> bool:
        return self.confirmed_at is not None

    def visible_at(self, as_of: datetime) -> bool:
        """O fato pode ser usado por uma decisão tomada em ``as_of``?"""
        as_of = ensure_utc(as_of)
        if as_of < self.available_at:
            return False
        if self.invalidated_at is not None and as_of >= self.invalidated_at:
            return False
        return True

    def confirmed_visible_at(self, as_of: datetime) -> bool:
        """Visível **e** confirmado em ``as_of``."""
        if not self.is_confirmed:
            return False
        assert self.confirmed_at is not None
        return self.visible_at(as_of) and ensure_utc(as_of) >= self.confirmed_at

    # -- transições --------------------------------------------------------

    def confirm(self, at: datetime, ingestion_latency: timedelta | None = None) -> EventTiming:
        """Retorna uma **nova** timing confirmada. Não muta a original."""
        if self.is_confirmed:
            raise CausalityViolation("evento já confirmado; histórico não se reescreve")
        at = ensure_utc(at)
        latency = ingestion_latency or timedelta(0)
        return replace(self, confirmed_at=at, available_at=max(self.available_at, at + latency))

    def invalidate(self, at: datetime) -> EventTiming:
        """Retorna uma **nova** timing invalidada. Não muta a original."""
        if self.invalidated_at is not None:
            raise CausalityViolation("evento já invalidado; histórico não se reescreve")
        return replace(self, invalidated_at=ensure_utc(at))

    def to_dict(self) -> dict[str, str | None]:
        return {
            "detected_at": self.detected_at.isoformat(),
            "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "available_at": self.available_at.isoformat(),
            "invalidated_at": (
                self.invalidated_at.isoformat() if self.invalidated_at else None
            ),
        }

    @staticmethod
    def confirmed_now(
        detected_at: datetime,
        confirmed_at: datetime,
        ingestion_latency: timedelta = timedelta(0),
    ) -> EventTiming:
        """Atalho para eventos que nascem já confirmados (ex.: barra fechada)."""
        confirmed = ensure_utc(confirmed_at)
        return EventTiming(
            detected_at=detected_at,
            confirmed_at=confirmed,
            available_at=confirmed + ingestion_latency,
        )


@dataclass(frozen=True, slots=True)
class AsOf:
    """Cursor temporal de uma avaliação.

    Encapsular o ``as_of`` em um tipo próprio evita que ele seja confundido
    com qualquer outro ``datetime`` na assinatura dos engines — o erro mais
    comum de look-ahead é passar o timestamp errado.
    """

    ts: datetime

    def __post_init__(self) -> None:
        object.__setattr__(self, "ts", ensure_utc(self.ts))

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.ts.isoformat()

    def minus(self, delta: timedelta) -> AsOf:
        return AsOf(self.ts - delta)
