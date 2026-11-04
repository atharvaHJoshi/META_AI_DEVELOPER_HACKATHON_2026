"""Django settings for MIRAIWERK AI.

Django owns the schema, migrations, ORM and admin. FastAPI owns the HTTP API.
Both run inside one ASGI process (see ``miraiwerk.asgi``).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent


def _load_dotenv() -> None:
    """Load the first available .env without adding a runtime dependency."""
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - dotenv is a declared dependency
        return
    for candidate in (BASE_DIR / ".env", REPO_ROOT / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)


_load_dotenv()

from core.env import (  # noqa: E402 - must run after .env is loaded
    DEV_DJANGO_SECRET,
    app_env,
    get_bool,
    get_int,
    get_list,
    is_production,
    secret,
    validate_production_config,
)

APP_ENV = app_env()
IS_PRODUCTION = is_production()
DEBUG = (not IS_PRODUCTION) and get_bool("DEBUG", True)
SECRET_KEY = secret("DJANGO_SECRET_KEY", DEV_DJANGO_SECRET)
ALLOWED_HOSTS = get_list("ALLOWED_HOSTS") or ([] if IS_PRODUCTION else ["*"])
CSRF_TRUSTED_ORIGINS = get_list("CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "platform_app",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "miraiwerk.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "miraiwerk.wsgi.application"
ASGI_APPLICATION = "miraiwerk.asgi.application"


def _database_from_url() -> dict:
    url = os.environ.get(
        "DATABASE_URL",
        "postgres://miraiwerk:miraiwerk_dev_pw@localhost:55434/miraiwerk",
    )
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection string.")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parsed.path.lstrip("/")),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "localhost",
        "PORT": str(parsed.port or 5432),
        "CONN_MAX_AGE": 0,
        "OPTIONS": {"connect_timeout": 5},
    }


DATABASES = {"default": _database_from_url()}

AUTHENTICATION_BACKENDS = ["platform_app.auth_backend.PasswordHashBackend"]
AUTH_USER_MODEL = "platform_app.User"
LOGIN_URL = "/admin/login/"
LOGIN_REDIRECT_URL = "/admin/"

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Admin access uses the product's own Argon2id/scrypt password hashes.
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False

# ---------------------------------------------------------------------------
# Security and email configuration
# ---------------------------------------------------------------------------
SESSION_COOKIE_SECURE = get_bool("COOKIE_SECURE", IS_PRODUCTION)
CSRF_COOKIE_SECURE = get_bool("COOKIE_SECURE", IS_PRODUCTION)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_SSL_REDIRECT = get_bool("SECURE_SSL_REDIRECT", IS_PRODUCTION)
SECURE_HSTS_SECONDS = get_int("SECURE_HSTS_SECONDS", 31536000 if IS_PRODUCTION else 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = get_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", IS_PRODUCTION)
SECURE_HSTS_PRELOAD = get_bool("SECURE_HSTS_PRELOAD", IS_PRODUCTION)
if get_bool("TRUST_X_FORWARDED_PROTO", IS_PRODUCTION):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"
)
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "MIRAIWERK AI <no-reply@miraiwerk.local>"
)
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = get_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = get_bool("EMAIL_USE_TLS", True)
EMAIL_USE_SSL = get_bool("EMAIL_USE_SSL", False)
EMAIL_TIMEOUT = get_int("EMAIL_TIMEOUT", 10)

if IS_PRODUCTION:
    validate_production_config()
# ---------------------------------------------------------------------------

