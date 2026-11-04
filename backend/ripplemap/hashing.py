"""JS-compatible JSON canonicalisation used for scenario input hashing."""

from __future__ import annotations

import hashlib
import json


def _normalise_number(value: int | float) -> int | float:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def stable_stringify(value: object) -> str:
    if value is None or not isinstance(value, (dict, list)):
        if isinstance(value, bool) or value is None or isinstance(value, (int, float)):
            value = _normalise_number(value) if isinstance(value, (int, float)) else value
            return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(item) for item in value) + "]"

    # JS: object entries with `undefined` values are dropped; our model has no
    # undefined, so every value (including null) is preserved.
    entries = sorted(value.items(), key=lambda pair: pair[0])
    inner = ",".join(
        f"{json.dumps(key, ensure_ascii=False)}:{stable_stringify(item)}"
        for key, item in entries
    )
    return "{" + inner + "}"


def hash_scenario_input(value: object) -> str:
    digest = hashlib.sha256(stable_stringify(value).encode("utf-8")).hexdigest()
    return digest[:16]
