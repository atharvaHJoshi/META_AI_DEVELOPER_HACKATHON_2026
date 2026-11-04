"""FastAPI application factory for the MIRAIWERK API.

Mounted under /api by ``miraiwerk.asgi`` alongside the Django admin.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anyio
import django
from django.conf import settings as django_settings

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "miraiwerk.settings")
if not django_settings.configured:
    django.setup()

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402

from core import config  # noqa: E402
from core.errors import ApiError, error_envelope  # noqa: E402
from django.db import close_old_connections  # noqa: E402

logger = logging.getLogger("miraiwerk")


def _flatten_validation_errors(exc: RequestValidationError) -> dict[str, Any]:
    field_errors: dict[str, list[str]] = {}
    form_errors: list[str] = []
    for error in exc.errors():
        loc = [
            str(part)
            for part in error.get("loc", ())
            if part not in {"body", "query", "path", "header"}
        ]
        message = str(error.get("msg", "Invalid value."))
        if loc:
            key = ".".join(loc)
            field_errors.setdefault(key, []).append(message)
        else:
            form_errors.append(message)
    return {"fieldErrors": field_errors, "formErrors": form_errors}


def create_app() -> FastAPI:
    app = FastAPI(
        title="MIRAIWERK AI API",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.FRONTEND_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "x-user-id",
            "x-workspace-id",
            "x-request-id",
        ],
    )

    @app.middleware("http")
    async def close_django_connections(request: Request, call_next):
        try:
            return await call_next(request)
        finally:
            await anyio.to_thread.run_sync(close_old_connections)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(error_envelope(exc), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "The request did not match the expected schema.",
                    "details": _flatten_validation_errors(exc),
                }
            },
            status_code=422,
        )

    @app.exception_handler(json.JSONDecodeError)
    async def json_error_handler(_request: Request, exc: json.JSONDecodeError) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": "INVALID_JSON",
                    "message": "The request body is not valid JSON.",
                }
            },
            status_code=400,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return JSONResponse(
                {
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "The requested resource does not exist.",
                    }
                },
                status_code=404,
            )
        if exc.status_code == 405:
            return JSONResponse(
                {
                    "error": {
                        "code": "METHOD_NOT_ALLOWED",
                        "message": "This endpoint does not support the requested method.",
                    }
                },
                status_code=405,
            )
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            {
                "error": {
                    "code": f"HTTP_{exc.status_code}",
                    "message": detail,
                }
            },
            status_code=exc.status_code,
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled API error", exc_info=exc)
        return JSONResponse(
            {
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected server error occurred.",
                }
            },
            status_code=500,
        )

    @app.get("/api/health")
    def health():
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        ai = config.ai_mode()
        return {
            "status": "ok",
            "time": _now_iso(),
            "ai": ai["provider"],
            "aiLabel": ai["label"],
        }

    from api.routers import (
        ai,
        auth,
        bootstrap,
        collab,
        decisions,
        projects,
        tasks,
        tickets,
        workspaces,
    )

    api = "/api"
    app.include_router(auth.router, prefix=api)
    app.include_router(bootstrap.router, prefix=api)
    app.include_router(tasks.router, prefix=api)
    app.include_router(collab.router, prefix=api)
    app.include_router(projects.router, prefix=api)
    app.include_router(tickets.router, prefix=api)
    app.include_router(decisions.router, prefix=api)
    app.include_router(workspaces.organizations_router, prefix=api)
    app.include_router(workspaces.workspaces_router, prefix=api)
    app.include_router(ai.router, prefix=api)

    return app


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
