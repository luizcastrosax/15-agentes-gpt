"""2. Session Engine.

Classifica a fase de sessão do instante ``as_of`` a partir de janelas
configuradas em hora local do fuso do mercado (``America/New_York`` para MNQ).

Limitações declaradas:

- O baseline **não** conhece feriados de bolsa nem meias-sessões. Ele conhece
  apenas dias da semana negociáveis. Um calendário de pregão real (CME) deve
  substituir ``trading_weekdays`` antes de qualquer operação com dinheiro.
- Horário de verão é tratado corretamente via ``zoneinfo``; janelas são
  definidas em hora local justamente para isso.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

from ..contracts.context import EvaluationContext
from ..domain.assessments import SessionState
from ..domain.enums import SessionPhase
from ..domain.errors import ConfigurationError

__all__ = ["BaselineSessionEngine"]

_PHASE_BY_NAME = {p.value: p for p in SessionPhase}


class BaselineSessionEngine:
    def classify(self, ctx: EvaluationContext) -> SessionState:
        cfg = ctx.config.session
        try:
            tz = ZoneInfo(cfg.timezone)
        except Exception as exc:  # noqa: BLE001
            raise ConfigurationError(f"timezone inválido: {cfg.timezone!r}") from exc

        local = ctx.now.astimezone(tz)
        minutes = local.hour * 60 + local.minute + local.second / 60.0
        notes: list[str] = []

        if local.weekday() not in cfg.trading_weekdays:
            return SessionState(
                phase=SessionPhase.MARKET_CLOSED,
                local_date=local.date().isoformat(),
                seconds_into_phase=None,
                seconds_to_phase_end=None,
                is_tradable_window=False,
                timezone_name=cfg.timezone,
                notes=("dia da semana fora de trading_weekdays",),
            )

        for window in cfg.windows:
            start = window.start_minutes
            end = window.end_minutes
            inside = start <= minutes < end if start < end else (minutes >= start or minutes < end)
            if not inside:
                continue
            phase = _PHASE_BY_NAME.get(window.name, SessionPhase.UNKNOWN)
            if phase is SessionPhase.UNKNOWN:
                notes.append(f"janela {window.name!r} não mapeia para SessionPhase conhecida")
            span = (end - start) % (24 * 60)
            into = (minutes - start) % (24 * 60)
            return SessionState(
                phase=phase,
                local_date=local.date().isoformat(),
                seconds_into_phase=into * 60.0,
                seconds_to_phase_end=(span - into) * 60.0,
                is_tradable_window=window.tradable,
                timezone_name=cfg.timezone,
                notes=tuple(notes) or ("calendário de feriados não considerado",),
            )

        return SessionState(
            phase=SessionPhase.OUT_OF_SCOPE,
            local_date=local.date().isoformat(),
            seconds_into_phase=None,
            seconds_to_phase_end=None,
            is_tradable_window=False,
            timezone_name=cfg.timezone,
            notes=("instante fora de todas as janelas configuradas",),
        )
