"""HTTP/runtime configuration for the ASGI composition.

Django settings owns the database; this module mirrors the non-database
knobs the original Express service exposed (auth TTLs, CORS, AI provider).
"""

from __future__ import annotations

import os

from miraiwerk import settings as django_settings


def _bool(value: str | None, fallback: bool) -> bool:
    if value is None or value == "":
        return fallback
    return value.lower() in {"true", "1"}


def _int(value: str | None, fallback: int) -> int:
    if value is None:
        return fallback
    try:
        return int(float(value))
    except ValueError:
        return fallback


_BASE_DIR = django_settings.BASE_DIR

# Django settings loads the first available .env (backend/.env then repo root).
_env_loaded = True

NODE_ENV = os.environ.get("NODE_ENV", "development")
IS_PRODUCTION = NODE_ENV.lower() == "production"
PORT = _int(os.environ.get("PORT"), 4000)
WEB_ORIGIN = os.environ.get("WEB_ORIGIN", "http://localhost:5173")
FRONTEND_ORIGINS = list(
    dict.fromkeys([WEB_ORIGIN, "http://localhost:5173", "http://127.0.0.1:5173"])
)

JWT_SECRET = os.environ.get(
    "JWT_SECRET", "miraiwerk-dev-only-secret-change-me-before-production"
)
ACCESS_TOKEN_TTL_SECONDS = _int(os.environ.get("ACCESS_TOKEN_TTL_SECONDS"), 900)
REFRESH_TOKEN_DAYS = _int(os.environ.get("REFRESH_TOKEN_DAYS"), 30)
AUTH_ALLOW_DEMO = _bool(os.environ.get("AUTH_ALLOW_DEMO"), True)
COOKIE_SECURE = _bool(os.environ.get("COOKIE_SECURE"), False)

AI_PROVIDER = (os.environ.get("AI_PROVIDER") or "auto").lower()
AI_FALLBACK_ON_ERROR = _bool(os.environ.get("AI_FALLBACK_ON_ERROR"), True)

DEMO_USER_EMAIL = "maya.chen@miraiwerk.demo"

META_OAUTH = {
    "appId": os.environ.get("META_APP_ID", ""),
    "appSecret": os.environ.get("META_APP_SECRET", ""),
    "redirectUri": os.environ.get(
        "META_OAUTH_REDIRECT_URI",
        "http://localhost:4000/api/auth/oauth/meta/callback",
    ),
    "graphVersion": os.environ.get("META_GRAPH_VERSION", "v21.0"),
}


def ai_mode() -> dict:
    import aiml

    gemini = aiml.get_gemini_config()
    meta = aiml.get_meta_config()
    requested = AI_PROVIDER
    if requested == "gemini":
        provider = "gemini" if gemini["apiKey"] else "deterministic-demo"
    elif requested == "meta":
        provider = "meta" if meta["apiKey"] else "deterministic-demo"
    elif requested == "deterministic":
        provider = "deterministic-demo"
    elif gemini["apiKey"]:
        provider = "gemini"
    elif meta["apiKey"]:
        provider = "meta"
    else:
        provider = "deterministic-demo"

    if provider == "gemini":
        model = gemini["model"]
        label = f"Google Gemini · {gemini['model']}"
    elif provider == "meta":
        model = meta["model"]
        label = f"Meta Model API · {meta['model']}"
    else:
        model = aiml.DETERMINISTIC_MODEL
        label = "Deterministic rules · no AI key configured"

    return {
        "provider": provider,
        "model": model,
        "usesGemini": provider == "gemini",
        "usesMeta": provider == "meta",
        "geminiConfigured": bool(gemini["apiKey"]),
        "metaConfigured": bool(meta["apiKey"]),
        "fallbackEnabled": AI_FALLBACK_ON_ERROR,
        "label": label,
    }
