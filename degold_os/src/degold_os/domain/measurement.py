"""Medida com proveniência obrigatória.

Princípio: **ausência de dado nunca equivale a zero** e **proxy deve ser
identificado como proxy**. Para tornar isso estrutural em vez de disciplinar,
nenhum engine devolve ``float`` cru: devolve ``Measurement`` ou ``None``.

- ``Measurement.value`` é sempre um número real observado/derivado.
- ``Measurement.source`` declara DIRECT / DERIVED / PROXY / SYNTHETIC.
- ``SourceKind.PROXY`` exige ``proxy_for`` preenchido (o que a medida
  *substitui*), caso contrário é ``ContractViolation``.
- Ausência é ``None`` no campo, ou ``MissingMeasurement`` quando é preciso
  carregar o motivo da ausência.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .enums import SourceKind
from .errors import ContractViolation

__all__ = ["Measurement", "MissingMeasurement", "MaybeMeasurement", "value_or_none"]


@dataclass(frozen=True, slots=True)
class Measurement:
    """Um valor numérico com unidade e proveniência."""

    value: float
    unit: str
    source: SourceKind
    #: Nome da grandeza que este proxy substitui. Obrigatório se source=PROXY.
    proxy_for: str | None = None
    #: Descrição curta de como o número foi obtido (auditoria).
    method: str = ""
    #: Quantidade de amostras usadas, quando aplicável.
    sample_size: int | None = None

    def __post_init__(self) -> None:
        if self.source is SourceKind.PROXY and not self.proxy_for:
            raise ContractViolation(
                "Measurement com source=PROXY exige proxy_for explícito "
                f"(unit={self.unit!r}, method={self.method!r})"
            )
        if self.source is not SourceKind.PROXY and self.proxy_for:
            raise ContractViolation(
                "proxy_for só pode ser preenchido quando source=PROXY"
            )

    @property
    def is_proxy(self) -> bool:
        return self.source is SourceKind.PROXY

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "unit": self.unit,
            "source": str(self.source),
            "proxy_for": self.proxy_for,
            "method": self.method,
            "sample_size": self.sample_size,
        }


@dataclass(frozen=True, slots=True)
class MissingMeasurement:
    """Ausência explícita, com motivo. Nunca é 0, nunca é falsy por acidente."""

    reason: str
    unit: str = ""
    #: Identificador da fonte que deveria ter provido o dado.
    expected_source: str = ""

    @property
    def is_proxy(self) -> bool:
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": None,
            "unit": self.unit,
            "source": "MISSING",
            "reason": self.reason,
            "expected_source": self.expected_source,
        }


MaybeMeasurement = Measurement | MissingMeasurement


def value_or_none(m: MaybeMeasurement | None) -> float | None:
    """Extrai o valor numérico, ou ``None`` se ausente.

    Existe para deixar o *site de chamada* explícito: quem chama isso está
    declarando que sabe lidar com ``None`` — e nunca com ``0.0`` implícito.
    """
    if isinstance(m, Measurement):
        return m.value
    return None


def require_measurements(**kwargs: MaybeMeasurement | None) -> dict[str, float] | list[str]:
    """Retorna os valores se todos presentes, ou a lista de nomes ausentes.

    Uso típico em engines::

        got = require_measurements(atr=atr, spread=spread)
        if isinstance(got, list):
            return NOT_AVAILABLE(f"faltando: {got}")
    """
    missing = [name for name, m in kwargs.items() if not isinstance(m, Measurement)]
    if missing:
        return sorted(missing)
    return {name: m.value for name, m in kwargs.items() if isinstance(m, Measurement)}


@dataclass(frozen=True, slots=True)
class Provenance:
    """Rastro de proveniência agregado de um cálculo composto."""

    inputs: tuple[str, ...] = field(default_factory=tuple)
    proxies_used: tuple[str, ...] = field(default_factory=tuple)

    @property
    def uses_proxy(self) -> bool:
        return bool(self.proxies_used)

    def to_dict(self) -> dict[str, Any]:
        return {"inputs": list(self.inputs), "proxies_used": list(self.proxies_used)}
