"""Conformidade entre os objetos produzidos e os schemas publicados.

Não usamos ``jsonschema`` (dependência externa): validamos as propriedades
que realmente importam — chaves obrigatórias, ausência de chaves não
declaradas e os enums — com um verificador mínimo. O objetivo é impedir que
o código e os schemas divirjam silenciosamente.
"""

from __future__ import annotations

import json
from pathlib import Path

import fixtures as F
import pytest

from degold_os.domain.enums import Decision
from degold_os.orchestration.orchestrator import DecisionOrchestrator

SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schemas"


def load(name: str) -> dict:
    return json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))


def check(payload: dict, schema: dict, where: str = "root") -> None:
    required = schema.get("required", [])
    missing = [k for k in required if k not in payload]
    assert not missing, f"{where}: faltam chaves obrigatórias {missing}"
    if schema.get("additionalProperties") is False:
        allowed = set(schema.get("properties", {}))
        extra = set(payload) - allowed
        assert not extra, f"{where}: chaves não declaradas no schema {sorted(extra)}"
    for key, spec in schema.get("properties", {}).items():
        if key not in payload or "enum" not in spec:
            continue
        value = payload[key]
        if value is not None:
            assert value in spec["enum"], f"{where}.{key}: {value!r} fora do enum"


@pytest.fixture(scope="module")
def record():
    return DecisionOrchestrator().evaluate(F.make_context(series=F.build_series()))


def test_all_schemas_are_valid_json():
    files = sorted(SCHEMA_DIR.glob("*.schema.json"))
    assert files
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["$schema"].startswith("https://json-schema.org/")
        assert data["$id"].endswith(path.name)


def test_decision_record_conforms(record):
    payload = record.to_dict()
    check(payload, load("decision_record.schema.json"), "DecisionRecord")


def test_gate_results_conform(record):
    schema = load("gate_result.schema.json")
    for item in record.to_dict()["gates"]["results"]:
        check(item, schema, item["gate"])


def test_trade_plan_conforms(record):
    assert record.decision is Decision.SHADOW_INTENT
    plan = record.to_dict()["trade_plan"]
    check(plan, load("trade_plan.schema.json"), "TradePlan")
    intent_schema = load("order_intent.schema.json")
    for key in ("entry_intent", "stop_intent", "target_intent"):
        check(plan[key], intent_schema, key)


def test_measurement_proxy_declares_what_it_replaces(record):
    plan = record.to_dict()["trade_plan"]
    cost = plan["cost_points"]
    check(cost, load("measurement.schema.json"), "cost_points")
    if cost["source"] == "PROXY":
        assert cost["proxy_for"], "PROXY sem proxy_for viola o schema e o domínio"


def test_bar_conforms():
    schema = load("market_bar.schema.json")
    series = F.build_series()
    from degold_os.domain.enums import Timeframe

    bar = list(series[Timeframe.M1])[0].to_dict()
    check(bar, schema, "Bar")
    check(bar["timing"], load("event_timing.schema.json"), "Bar.timing")


def test_telemetry_envelope_conforms(tmp_path, record):
    from degold_os.telemetry.sinks import JsonlTelemetrySink

    path = tmp_path / "t.jsonl"
    JsonlTelemetrySink(path).emit_decision(record)
    line = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    check(line, load("telemetry_event.schema.json"), "TelemetryEvent")
    check(line["payload"], load("decision_record.schema.json"), "payload")
