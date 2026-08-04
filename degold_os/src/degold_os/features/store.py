"""13. Feature Store — append-only, com consulta as-of.

Garantias:

- ``put`` nunca sobrescreve: gravar o mesmo ``(name, as_of)`` com valor
  diferente levanta ``CausalityViolation``. Regravar o valor idêntico é
  idempotente e permitido (reprocessamento).
- ``get(name, as_of)`` devolve o registro mais recente com
  ``available_at <= as_of``. Se não houver nenhum, devolve ``None`` — e
  ``None`` significa *desconhecido*, nunca zero.
- ``available_at >= as_of`` sempre: uma feature calculada com dados até T não
  pode estar disponível antes de T.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterator, Mapping, Sequence

from ..domain.errors import CausalityViolation
from ..domain.timing import ensure_utc

__all__ = ["FeatureRecord", "InMemoryFeatureStore"]


@dataclass(frozen=True, slots=True)
class FeatureRecord:
    name: str
    value: Any
    as_of: datetime
    available_at: datetime
    meta: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "as_of": self.as_of.isoformat(),
            "available_at": self.available_at.isoformat(),
            "meta": dict(self.meta),
        }


class InMemoryFeatureStore:
    """Implementação de referência do ``FeatureStore``.

    Suficiente para MVP, backtest e shadow mode de um instrumento. Uma versão
    persistente (parquet/duckdb) deve preservar exatamente estas invariantes;
    elas são o que torna o backtest honesto.
    """

    __slots__ = ("_data",)

    def __init__(self) -> None:
        # name -> (lista ordenada de available_at, lista de FeatureRecord)
        self._data: dict[str, tuple[list[datetime], list[FeatureRecord]]] = {}

    def put(
        self,
        name: str,
        value: Any,
        as_of: datetime,
        available_at: datetime,
        meta: Mapping[str, Any] | None = None,
    ) -> None:
        as_of = ensure_utc(as_of)
        available_at = ensure_utc(available_at)
        if available_at < as_of:
            raise CausalityViolation(
                f"feature {name!r}: available_at ({available_at.isoformat()}) "
                f"não pode preceder as_of ({as_of.isoformat()})"
            )
        keys, records = self._data.setdefault(name, ([], []))
        idx = bisect.bisect_left(keys, available_at)
        # detecta regravação do mesmo instante
        for j in range(idx, len(keys)):
            if keys[j] != available_at:
                break
            if records[j].as_of == as_of:
                if records[j].value == value:
                    return  # idempotente
                raise CausalityViolation(
                    f"feature {name!r} em {as_of.isoformat()} já existe com outro valor: "
                    "histórico confirmado não é reescrito"
                )
        rec = FeatureRecord(name, value, as_of, available_at, dict(meta or {}))
        keys.insert(idx, available_at)
        records.insert(idx, rec)

    def get(self, name: str, as_of: datetime) -> Any | None:
        rec = self.get_record(name, as_of)
        return rec.value if rec is not None else None

    def get_record(self, name: str, as_of: datetime) -> FeatureRecord | None:
        as_of = ensure_utc(as_of)
        entry = self._data.get(name)
        if entry is None:
            return None
        keys, records = entry
        idx = bisect.bisect_right(keys, as_of)
        if idx == 0:
            return None
        return records[idx - 1]

    def history(self, name: str, as_of: datetime) -> Sequence[FeatureRecord]:
        as_of = ensure_utc(as_of)
        entry = self._data.get(name)
        if entry is None:
            return ()
        keys, records = entry
        idx = bisect.bisect_right(keys, as_of)
        return tuple(records[:idx])

    def names(self) -> Sequence[str]:
        return tuple(sorted(self._data))

    def __iter__(self) -> Iterator[FeatureRecord]:
        for _, records in self._data.values():
            yield from records

    def __len__(self) -> int:
        return sum(len(r) for _, r in self._data.values())
