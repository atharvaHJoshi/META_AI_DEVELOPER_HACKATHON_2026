"""API error envelope.

Every non-2xx response matches the documented contract::

    {"error": {"code": "SOME_CODE", "message": "Human readable", "details": ...}}
"""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def error_envelope(error: ApiError) -> dict:
    payload: dict[str, Any] = {"code": error.code, "message": error.message}
    if error.details is not None:
        payload["details"] = error.details
    return {"error": payload}
