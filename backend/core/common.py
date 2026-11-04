"""Shared serialisation and id helpers for the FastAPI service layer."""

from __future__ import annotations

import re
import secrets
from datetime import date, datetime
from decimal import Decimal
from typing import Any


def iso_datetime(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        text = value.isoformat()
        if text.endswith("+00:00"):
            text = text[:-6] + "Z"
        return text
    if isinstance(value, str):
        return value
    return str(value)


def iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def num(value: Any) -> int | float:
    if value is None:
        return 0
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 1)
    return value


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(10)}"


def slugify(value: str) -> str:
    base = value.lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:48]
    return base or "workspace"
