"""AIML runtime configuration.

Values are read lazily so callers can load `.env` before the first model
call. The package never reads or persists secrets on behalf of the browser.
"""

from __future__ import annotations

import os

DETERMINISTIC_MODEL = "miraiwerk-rules-v1"


def _number_from_env(value: str | None, fallback: float) -> float:
    try:
        parsed = float(value) if value is not None else None
    except ValueError:
        return fallback
    return parsed if parsed is not None and parsed == parsed else fallback


def _int_from_env(value: str | None, fallback: int) -> int:
    try:
        return int(float(value)) if value is not None else fallback
    except ValueError:
        return fallback


def _bool_from_env(value: str | None, fallback: bool) -> bool:
    if value is None or value == "":
        return fallback
    return value.lower() in {"true", "1"}


def get_meta_config() -> dict:
    return {
        "apiKey": os.environ.get("MODEL_API_KEY") or os.environ.get("META_API_KEY") or "",
        "baseUrl": os.environ.get("META_BASE_URL", "https://api.meta.ai/v1"),
        "model": os.environ.get("META_MODEL", "muse-spark-1.3"),
        "timeoutMs": _int_from_env(os.environ.get("META_TIMEOUT_MS"), 45_000),
        "maxRetries": _int_from_env(os.environ.get("META_MAX_RETRIES"), 2),
        "useTools": _bool_from_env(os.environ.get("META_TOOLS"), True),
    }


def has_meta_key() -> bool:
    return bool(get_meta_config()["apiKey"])


def get_gemini_config() -> dict:
    return {
        "apiKey": os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_AI_API_KEY") or "",
        "model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        "baseUrl": os.environ.get(
            "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
        ),
        "timeoutMs": _int_from_env(os.environ.get("GEMINI_TIMEOUT_MS"), 45_000),
        "maxRetries": _int_from_env(os.environ.get("GEMINI_MAX_RETRIES"), 1),
    }


def has_gemini_key() -> bool:
    return bool(get_gemini_config()["apiKey"])
