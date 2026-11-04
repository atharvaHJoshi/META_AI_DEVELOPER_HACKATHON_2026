"""FastAPI dependencies: current user, workspace header resolution."""

from __future__ import annotations

from fastapi import Request

from core import config
from core.errors import ApiError
from core.security import verify_access_token
from services import authz


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def current_user(request: Request) -> dict:
    token = bearer_token(request)
    user: dict | None = None
    if token:
        claims = verify_access_token(token)
        if claims is None:
            raise ApiError(401, "INVALID_TOKEN", "Your session has expired. Sign in again.")
        user = authz.get_user_by_id(claims["sub"])
    elif config.AUTH_ALLOW_DEMO:
        demo = request.headers.get("x-user-id")
        if demo and demo.strip():
            user = authz.get_user_by_id(demo.strip())

    if user is None:
        raise ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")
    if user.get("status") and user["status"] != "active":
        raise ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")
    return user


def optional_current_user(request: Request) -> dict | None:
    try:
        return current_user(request)
    except ApiError:
        return None


def workspace_id(request: Request) -> str | None:
    value = request.headers.get("x-workspace-id")
    if not value:
        value = request.query_params.get("workspaceId")
    return value.strip() if value and value.strip() else None


def require_workspace_id(request: Request) -> str:
    value = workspace_id(request)
    if not value:
        raise ApiError(
            400,
            "WORKSPACE_REQUIRED",
            "Select a workspace (x-workspace-id) before using this operation.",
        )
    return value
