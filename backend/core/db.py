"""Raw-cursor helpers plus JSON-column decoding.

Django's ORM already decodes JSONField values to Python objects; raw SQL
through ``connection.cursor()`` does not. Every JSON column read from a raw
cursor must pass through ``parse_json``.
"""

from __future__ import annotations

import json
from typing import Any


def fetchall_dicts(cursor) -> list[dict]:
    rows = cursor.fetchall()
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def fetchone_dict(cursor) -> dict | None:
    row = cursor.fetchone()
    if row is None:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def parse_json(value: Any, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value
