"""UTC working-day helpers. Weekends are excluded; holidays are not modelled."""

from __future__ import annotations

import re
from datetime import date, timedelta

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_iso_date(value: str) -> date:
    if not ISO_DATE_RE.match(value):
        raise ValueError(f"Invalid ISO date: {value}")
    year, month, day = (int(part) for part in value.split("-"))
    try:
        return date(year, month, day)
    except ValueError as exc:
        raise ValueError(f"Invalid ISO date: {value}") from exc


def is_iso_date(value: object) -> bool:
    return isinstance(value, str) and bool(ISO_DATE_RE.match(value))


def format_iso_date(value: date) -> str:
    return value.isoformat()


def is_weekend(value: date) -> bool:
    return value.weekday() >= 5


def next_working_day(value: date) -> date:
    current = value
    while is_weekend(current):
        current += timedelta(days=1)
    return current


def add_calendar_days(value: date, days: int) -> date:
    return value + timedelta(days=days)


def add_working_days(value: date, days: int) -> date:
    remaining = abs(days)
    step = -1 if days < 0 else 1
    current = value
    while remaining > 0:
        current += timedelta(days=step)
        if not is_weekend(current):
            remaining -= 1
    return current


def calendar_days_between(from_value: str | date, to_value: str | date) -> int:
    start = parse_iso_date(from_value) if isinstance(from_value, str) else from_value
    end = parse_iso_date(to_value) if isinstance(to_value, str) else to_value
    return (end - start).days


def working_days_between(from_value: str | date, to_value: str | date) -> int:
    start = parse_iso_date(from_value) if isinstance(from_value, str) else from_value
    end = parse_iso_date(to_value) if isinstance(to_value, str) else to_value
    if end <= start:
        return 0
    count = 0
    cursor = start
    while cursor < end:
        cursor += timedelta(days=1)
        if not is_weekend(cursor):
            count += 1
    return count


def count_working_days_inclusive(from_value: str | date, to_value: str | date) -> int:
    start = parse_iso_date(from_value) if isinstance(from_value, str) else from_value
    end = parse_iso_date(to_value) if isinstance(to_value, str) else to_value
    if end < start:
        return 0
    count = 0
    cursor = start
    while cursor <= end:
        if not is_weekend(cursor):
            count += 1
        cursor += timedelta(days=1)
    return count


def working_day_duration(estimate_days: float) -> int:
    import math

    return max(1, math.ceil(estimate_days))
