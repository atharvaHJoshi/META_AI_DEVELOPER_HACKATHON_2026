"""JWT access tokens and rotating opaque refresh tokens."""

from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any

import jwt

from core import config
from core.errors import ApiError

_ISSUER = "miraiwerk-ai"
_ACCESS_AUDIENCE = "miraiwerk-web"
_OAUTH_AUDIENCE = "miraiwerk-oauth"


def sign_access_token(user: dict[str, Any]) -> tuple[str, int]:
    expires_in = config.ACCESS_TOKEN_TTL_SECONDS
    issued = int(time.time())
    claims = {
        "sub": user["id"],
        "email": user["email"],
        "name": user["name"],
        "purpose": "access",
        "iss": _ISSUER,
        "aud": _ACCESS_AUDIENCE,
        "iat": issued,
        "exp": issued + expires_in,
    }
    token = jwt.encode(claims, config.JWT_SECRET, algorithm="HS256")
    return token, expires_in


def verify_access_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(
            token,
            config.JWT_SECRET,
            algorithms=["HS256"],
            issuer=_ISSUER,
            audience=_ACCESS_AUDIENCE,
        )
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != "access" or not isinstance(payload.get("sub"), str):
        return None
    return {
        "sub": payload["sub"],
        "email": payload.get("email", ""),
        "name": payload.get("name", ""),
        "purpose": "access",
    }


def sign_oauth_state(return_to: str) -> str:
    issued = int(time.time())
    claims = {
        "purpose": "oauth",
        "returnTo": return_to,
        "iss": _ISSUER,
        "aud": _OAUTH_AUDIENCE,
        "iat": issued,
        "exp": issued + 600,
    }
    return jwt.encode(claims, config.JWT_SECRET, algorithm="HS256")


def verify_oauth_state(state: str) -> dict[str, str] | None:
    try:
        payload = jwt.decode(
            state,
            config.JWT_SECRET,
            algorithms=["HS256"],
            issuer=_ISSUER,
            audience=_OAUTH_AUDIENCE,
        )
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != "oauth":
        return None
    return_to = payload.get("returnTo")
    return {"returnTo": return_to if isinstance(return_to, str) else "/"}


def create_opaque_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def refresh_cookie_options() -> dict[str, Any]:
    max_age = config.REFRESH_TOKEN_DAYS * 24 * 60 * 60
    return {
        "httponly": True,
        "secure": config.COOKIE_SECURE,
        "samesite": "lax",
        "path": "/",
        "max_age": max_age,
    }
