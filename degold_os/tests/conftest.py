"""Configuração de testes: garante ``src/`` e ``tests/`` no ``sys.path``."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for candidate in (ROOT / "src", ROOT / "tests"):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))
