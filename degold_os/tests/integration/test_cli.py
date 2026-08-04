"""Integração da CLI: validar configuração e rodar replay ponta a ponta."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import fixtures as F
import pytest

from degold_os.cli.main import build_parser, main
from degold_os.configuration.loader import DEFAULT_CONFIG_PATH


def _write_config(tmp_path: Path, **overrides) -> Path:
    raw = copy.deepcopy(json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8")))
    raw.pop("instrument_ref", None)
    raw["instrument"] = {
        "symbol": "MNQ",
        "tick_size": 0.25,
        "point_value": 2.0,
        "currency": "USD",
        "exchange": "CME",
    }
    raw["data_quality"] = {
        "required_timeframes": ["H4", "M15", "M5", "M2", "M1"],
        "min_bars": {"H4": 20, "M15": 30, "M5": 30, "M2": 30, "M1": 30},
        "max_staleness_multiple": 3.0,
        "max_feed_staleness_seconds": 90,
    }
    raw["regime"] = {
        "htf": "H4",
        "mtf": "M15",
        "atr_period": 5,
        "atr_percentile_lookback": 20,
        "ema_fast": 5,
        "ema_slow": 10,
        "vol_percentile_bounds": [0.2, 0.6, 0.9],
        "allowed_regimes": ["TREND_UP", "TREND_DOWN", "BALANCE"],
    }
    raw["telemetry"] = {
        "enabled": True,
        "sink": "jsonl",
        "path": str(tmp_path / "telemetry.jsonl"),
        "log_all_decisions": True,
    }
    for key, value in overrides.items():
        raw[key] = value
    path = tmp_path / "config.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    return path


@pytest.fixture(scope="module")
def data_dir(tmp_path_factory):
    root = tmp_path_factory.mktemp("bars")
    for tf, series in F.build_series().items():
        F.write_csv(series, root / f"{tf}.csv")
    return root


def test_parser_has_no_live_command():
    parser = build_parser()
    actions = [a for a in parser._actions if a.dest == "command"]
    assert actions, "subcomandos não encontrados"
    assert "live" not in actions[0].choices
    assert set(actions[0].choices) == {"validate-config", "replay", "explain"}


def test_validate_config_succeeds(tmp_path, capsys):
    cfg = _write_config(tmp_path)
    assert main(["--config", str(cfg), "validate-config"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["ok"] is True
    assert out["config_hash"]


def test_validate_config_fails_on_broken_file(tmp_path, capsys):
    raw = json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
    del raw["risk"]
    path = tmp_path / "broken.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    assert main(["--config", str(path), "validate-config"]) == 2


def test_replay_runs_and_reports_metrics(tmp_path, data_dir, capsys):
    cfg = _write_config(tmp_path)
    code = main(
        [
            "--config",
            str(cfg),
            "replay",
            "--data-dir",
            str(data_dir),
            "--decision-timeframe",
            "M5",
        ]
    )
    assert code == 0
    metrics = json.loads(capsys.readouterr().out)
    assert metrics["total"] > 100
    # Sem calendário macro fornecido, nada passa: fail-closed do começo ao fim.
    assert metrics["by_decision"] == {"NO_TRADE": metrics["total"]}
    # As primeiras avaliações têm histórico curto (G0); depois o bloqueio passa
    # a ser a ausência de calendário macro (G1).
    assert metrics["blocked_at"]["G0_DATA"] >= 1
    assert metrics["blocked_at"]["G1_MACRO"] >= 1
    assert Path(tmp_path / "telemetry.jsonl").exists()


def test_explain_prints_gate_by_gate(tmp_path, data_dir, capsys):
    cfg = _write_config(tmp_path)
    code = main(
        [
            "--config",
            str(cfg),
            "explain",
            "--data-dir",
            str(data_dir),
            "--at",
            F.DECISION_AT.isoformat(),
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "G0_DATA" in out
    assert "NO_TRADE" in out  # sem calendário e em RESEARCH


def test_replay_without_data_returns_error(tmp_path, capsys):
    cfg = _write_config(tmp_path)
    empty = tmp_path / "vazio"
    empty.mkdir()
    assert main(["--config", str(cfg), "replay", "--data-dir", str(empty)]) == 2
