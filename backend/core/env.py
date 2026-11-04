"""Environment parsing and production-configuration guardrails.

This module deliberately has no Django or FastAPI imports so it can be used by
both ``miraiwerk.settings`` and ``core.config`` without a circular dependency.
"""

from __future__ import annotations

import os

DEV_JWT_SECRET = "miraiwerk-dev-only-secret-change-me-before-production"
DEV_DJANGO_SECRET = DEV_JWT_SECRET
MIN_SECRET_LENGTH = 32
KNOWN_DEV_SECRETS = {
    DEV_JWT_SECRET,
    DEV_DJANGO_SECRET,
    "replace-with-a-long-random-secret-before-deploying",
    "changeme",
    "secret",
}


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value is not None and value != "" else default


def app_env() -> str:
    return (env("APP_ENV") or env("NODE_ENV") or "development").strip().lower()


def is_production() -> bool:
    return app_env() in {"production", "prod"}


def get_bool(name: str, fallback: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return fallback
    return value.strip().lower() in {"true", "1", "yes", "on"}


def get_int(name: str, fallback: int) -> int:
    value = os.environ.get(name)
    if value is None or value == "":
        return fallback
    try:
        return int(float(value))
    except ValueError:
        return fallback


def get_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def secret(name: str, dev_fallback: str) -> str:
    """Return a configured secret, or the development fallback in dev.

    Production deployments must provide their own value explicitly. The check
    runs at import time so an insecure deployment fails before serving traffic.
    """
    value = env(name)
    if not is_production():
        return value or dev_fallback
    if not value:
        raise RuntimeError(
            f"{name} must be set in production. Generate a value with: openssl rand -hex 32"
        )
    if value in KNOWN_DEV_SECRETS or len(value) < MIN_SECRET_LENGTH:
        raise RuntimeError(
            f"{name} is not strong enough for production. "
            f"Use at least {MIN_SECRET_LENGTH} random characters and never reuse a documented default."
        )
    return value


def production_issues() -> list[str]:
    """Return configuration problems that would make a production deploy unsafe."""
    if not is_production():
        return []
    issues: list[str] = []
    for name in ("JWT_SECRET", "DJANGO_SECRET_KEY"):
        value = env(name)
        if not value:
            issues.append(f"{name} is missing.")
        elif value in KNOWN_DEV_SECRETS or len(value) < MIN_SECRET_LENGTH:
            issues.append(f"{name} is a development default or shorter than {MIN_SECRET_LENGTH} characters.")
    hosts = get_list("ALLOWED_HOSTS")
    if not hosts:
        issues.append("ALLOWED_HOSTS must list the production hostnames.")
    elif "*" in hosts:
        issues.append("ALLOWED_HOSTS must not contain a wildcard in production.")
    if not get_list("FRONTEND_ORIGINS") and not env("WEB_ORIGIN"):
        issues.append("FRONTEND_ORIGINS or WEB_ORIGIN must be configured for CORS.")
    if not get_bool("COOKIE_SECURE", True):
        issues.append("COOKIE_SECURE must be true in production.")
    if not get_bool("SECURE_SSL_REDIRECT", True):
        issues.append("SECURE_SSL_REDIRECT must be true in production.")
    email_backend = env("EMAIL_BACKEND", "")
    if not email_backend or "console" in email_backend.lower():
        issues.append("EMAIL_BACKEND must use a real transactional email backend in production.")
    if get_bool("AUTH_ALLOW_DEMO", False):
        issues.append("AUTH_ALLOW_DEMO must be false in production; seeded demo sign-in is not a production identity.")
    return issues


def validate_production_config() -> None:
    issues = production_issues()
    if issues:
        detail = "\n".join(f"- {issue}" for issue in issues)
        raise RuntimeError(f"Invalid production configuration:\n{detail}")
