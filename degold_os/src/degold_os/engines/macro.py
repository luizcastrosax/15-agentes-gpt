"""3. Macro Engine (G1).

Determina se ``as_of`` está em blackout por evento macroeconômico.

Ponto crítico de honestidade: **não existe calendário embutido**. Se
``ctx.macro_events is None``, o calendário está indisponível e o resultado é
``calendar_available=False``. O gate G1 traduz isso em ``NOT_AVAILABLE``, que
a política fail-closed converte em bloqueio quando ``require_calendar=True``.

Distinção que o sistema preserva:
- ``macro_events is None``  → não sabemos se há eventos (bloqueia).
- ``macro_events == []``    → sabemos que não há eventos (libera).

Confundir os dois é exatamente o erro "ausência de dado = zero".
"""

from __future__ import annotations

from ..contracts.context import EvaluationContext
from ..domain.assessments import MacroAssessment

__all__ = ["BaselineMacroEngine"]


class BaselineMacroEngine:
    def assess(self, ctx: EvaluationContext) -> MacroAssessment:
        cfg = ctx.config.macro
        events = ctx.visible_macro_events()

        if events is None:
            return MacroAssessment(
                calendar_available=False,
                in_blackout=False,
                blocking_event_name=None,
                seconds_to_next_high_impact=None,
                events_considered=0,
                notes=(
                    "calendário macro indisponível: nenhuma inferência sobre eventos "
                    "é possível (ausência de dado ≠ ausência de evento)",
                ),
            )

        blocking = {i.upper() for i in cfg.blocking_impacts}
        now = ctx.now
        in_blackout = False
        blocking_name: str | None = None
        next_seconds: float | None = None

        for ev in events:
            if ev.impact.upper() not in blocking:
                continue
            delta = (ev.scheduled_at - now).total_seconds()
            if -cfg.blackout_after_seconds <= delta <= cfg.blackout_before_seconds:
                in_blackout = True
                if blocking_name is None or abs(delta) < abs(next_seconds or 1e18):
                    blocking_name = ev.name
            if delta >= 0 and (next_seconds is None or delta < next_seconds):
                next_seconds = delta

        notes: list[str] = []
        if not events:
            notes.append("calendário disponível e sem eventos no horizonte consultado")
        if in_blackout:
            notes.append(f"blackout ativo por evento de alto impacto: {blocking_name}")

        return MacroAssessment(
            calendar_available=True,
            in_blackout=in_blackout,
            blocking_event_name=blocking_name,
            seconds_to_next_high_impact=next_seconds,
            events_considered=len(events),
            notes=tuple(notes),
        )
