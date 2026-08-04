"""14. Telemetria.

Três sinks, todos com a mesma interface:

- ``NullTelemetrySink``   — descarta (default seguro em testes).
- ``StdoutTelemetrySink`` — JSON por linha em stdout.
- ``JsonlTelemetrySink``  — JSON por linha em arquivo, append-only.

Todo evento carrega ``schema_version``, ``emitted_at`` e ``event_type``. O
formato é JSONL porque é append-only por natureza — coerente com a regra de
que histórico confirmado não se reescreve.

O que **não** é emitido: nada que já não esteja no ``DecisionRecord``. A
telemetria não é um canal paralelo de verdade; é a serialização do mesmo
registro auditável.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, TextIO

from ..domain.decision import DecisionRecord

__all__ = [
    "TELEMETRY_SCHEMA_VERSION",
    "NullTelemetrySink",
    "StdoutTelemetrySink",
    "JsonlTelemetrySink",
    "build_sink",
]

TELEMETRY_SCHEMA_VERSION = "1.0.0"


def _envelope(event_type: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": TELEMETRY_SCHEMA_VERSION,
        "event_type": event_type,
        "emitted_at": datetime.now(timezone.utc).isoformat(),
        "payload": dict(payload),
    }


class NullTelemetrySink:
    def emit(self, event_type: str, payload: Mapping[str, Any]) -> None:
        return None

    def emit_decision(self, record: DecisionRecord) -> None:
        return None

    def flush(self) -> None:
        return None


class _StreamSink:
    __slots__ = ("_stream",)

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream

    def emit(self, event_type: str, payload: Mapping[str, Any]) -> None:
        line = json.dumps(_envelope(event_type, payload), ensure_ascii=False, default=str)
        self._stream.write(line + "\n")

    def emit_decision(self, record: DecisionRecord) -> None:
        self.emit("decision", record.to_dict())

    def flush(self) -> None:
        self._stream.flush()


class StdoutTelemetrySink(_StreamSink):
    def __init__(self) -> None:
        super().__init__(sys.stdout)


class JsonlTelemetrySink:
    """Sink em arquivo JSONL, aberto em modo append.

    Aberto e fechado a cada escrita para sobreviver a interrupções — em um
    sistema que pode ser morto a qualquer momento, perder o buffer é perder a
    auditoria da última decisão, que é exatamente a que interessa.
    """

    __slots__ = ("path",)

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, event_type: str, payload: Mapping[str, Any]) -> None:
        line = json.dumps(_envelope(event_type, payload), ensure_ascii=False, default=str)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    def emit_decision(self, record: DecisionRecord) -> None:
        self.emit("decision", record.to_dict())

    def flush(self) -> None:
        return None


def build_sink(kind: str, path: str | None = None):
    kind = (kind or "null").lower()
    if kind == "stdout":
        return StdoutTelemetrySink()
    if kind == "jsonl":
        if not path:
            raise ValueError("sink jsonl exige 'path'")
        return JsonlTelemetrySink(path)
    return NullTelemetrySink()
