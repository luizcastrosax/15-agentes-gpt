"""Provedor de calendário macro a partir de arquivo local.

**Não há integração com nenhum fornecedor de calendário.** Este adapter lê um
JSON que você fornece. Se o arquivo não existir, ele devolve ``None`` —
"calendário indisponível" — e o Gate G1 bloqueia por política. Ele nunca
devolve lista vazia para disfarçar ausência.

Formato do arquivo (lista de objetos)::

    [
      {
        "event_id": "cpi_2026_03",
        "name": "US CPI m/m",
        "scheduled_at": "2026-03-11T12:30:00+00:00",
        "impact": "HIGH",
        "country": "US",
        "source": "<nome da sua fonte>",
        "published_at": "2026-02-25T00:00:00+00:00"
      }
    ]

``published_at`` é o instante em que a *entrada do calendário* passou a ser
conhecida — é ele que vira ``available_at``. Sem ele, o backtest usaria o
calendário de hoje para decidir no passado, o que é look-ahead.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Sequence

from ..domain.errors import DataQualityError
from ..domain.events import MacroEvent
from ..domain.timing import EventTiming, ensure_utc

__all__ = ["load_macro_events"]

_REQUIRED = {"event_id", "name", "scheduled_at", "impact"}


def load_macro_events(path: str | Path | None) -> Sequence[MacroEvent] | None:
    """Carrega eventos. Devolve ``None`` quando o calendário é indisponível."""
    if path is None:
        return None
    p = Path(path)
    if not p.exists():
        return None

    raw = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise DataQualityError(f"calendário macro deve ser uma lista: {p}")

    events: list[MacroEvent] = []
    for i, item in enumerate(raw):
        missing = _REQUIRED - set(item)
        if missing:
            raise DataQualityError(
                f"evento {i} em {p}: campos obrigatórios ausentes {sorted(missing)}"
            )
        scheduled = ensure_utc(datetime.fromisoformat(str(item["scheduled_at"])))
        published_raw = item.get("published_at")
        if published_raw is None:
            raise DataQualityError(
                f"evento {item['event_id']}: 'published_at' é obrigatório — sem ele "
                "não é possível saber quando a informação ficou disponível"
            )
        published = ensure_utc(datetime.fromisoformat(str(published_raw)))
        events.append(
            MacroEvent(
                event_id=str(item["event_id"]),
                name=str(item["name"]),
                scheduled_at=scheduled,
                impact=str(item["impact"]).upper(),
                timing=EventTiming(
                    detected_at=published,
                    confirmed_at=published,
                    available_at=published,
                ),
                source=str(item.get("source", "arquivo local")),
                country=str(item.get("country", "")),
            )
        )
    return tuple(sorted(events, key=lambda e: e.scheduled_at))
