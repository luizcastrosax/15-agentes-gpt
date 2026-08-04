"""Invariantes temporais — a base de toda a causalidade do sistema."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from degold_os.domain.errors import CausalityViolation
from degold_os.domain.timing import AsOf, EventTiming, ensure_utc

UTC = timezone.utc
T0 = datetime(2026, 6, 2, 13, 0, tzinfo=UTC)


def test_naive_datetime_is_rejected():
    with pytest.raises(CausalityViolation):
        ensure_utc(datetime(2026, 6, 2, 13, 0))


def test_non_utc_is_normalized():
    other = timezone(timedelta(hours=-4))
    assert ensure_utc(datetime(2026, 6, 2, 9, 0, tzinfo=other)) == T0


def test_available_at_cannot_precede_detected_at():
    with pytest.raises(CausalityViolation):
        EventTiming(detected_at=T0, available_at=T0 - timedelta(seconds=1))


def test_confirmed_at_cannot_precede_detected_at():
    with pytest.raises(CausalityViolation):
        EventTiming(
            detected_at=T0,
            confirmed_at=T0 - timedelta(seconds=1),
            available_at=T0,
        )


def test_available_at_cannot_precede_confirmed_at():
    with pytest.raises(CausalityViolation):
        EventTiming(
            detected_at=T0 - timedelta(minutes=1),
            confirmed_at=T0,
            available_at=T0 - timedelta(seconds=30),
        )


def test_invalidated_at_cannot_precede_available_at():
    with pytest.raises(CausalityViolation):
        EventTiming(
            detected_at=T0,
            available_at=T0 + timedelta(seconds=1),
            invalidated_at=T0,
        )


def test_visible_only_from_available_at():
    t = EventTiming(detected_at=T0, confirmed_at=T0, available_at=T0 + timedelta(seconds=1))
    assert not t.visible_at(T0)
    assert t.visible_at(T0 + timedelta(seconds=1))
    assert t.visible_at(T0 + timedelta(hours=1))


def test_unconfirmed_event_never_confirmed_visible():
    t = EventTiming(detected_at=T0, available_at=T0)
    assert t.visible_at(T0) is True
    assert t.confirmed_visible_at(T0) is False


def test_invalidated_event_stops_being_visible():
    t = EventTiming(
        detected_at=T0,
        confirmed_at=T0,
        available_at=T0,
        invalidated_at=T0 + timedelta(minutes=5),
    )
    assert t.visible_at(T0 + timedelta(minutes=4))
    assert not t.visible_at(T0 + timedelta(minutes=5))


def test_confirm_returns_new_object_and_does_not_mutate():
    t = EventTiming(detected_at=T0, available_at=T0)
    t2 = t.confirm(T0 + timedelta(minutes=1), timedelta(milliseconds=250))
    assert t.confirmed_at is None, "objeto original não pode ser mutado"
    assert t2.confirmed_at == T0 + timedelta(minutes=1)
    assert t2.available_at == T0 + timedelta(minutes=1, milliseconds=250)


def test_double_confirmation_is_history_rewrite():
    t = EventTiming(detected_at=T0, available_at=T0).confirm(T0)
    with pytest.raises(CausalityViolation):
        t.confirm(T0 + timedelta(minutes=1))


def test_double_invalidation_is_history_rewrite():
    t = EventTiming(detected_at=T0, confirmed_at=T0, available_at=T0).invalidate(T0)
    with pytest.raises(CausalityViolation):
        t.invalidate(T0 + timedelta(minutes=1))


def test_asof_normalizes_and_supports_rewind():
    a = AsOf(datetime(2026, 6, 2, 9, 0, tzinfo=timezone(timedelta(hours=-4))))
    assert a.ts == T0
    assert a.minus(timedelta(hours=1)).ts == T0 - timedelta(hours=1)
