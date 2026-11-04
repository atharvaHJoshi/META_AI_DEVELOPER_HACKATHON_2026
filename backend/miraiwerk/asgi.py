"""ASGI entrypoint: Django admin under /admin, FastAPI API under /api.

Run with: uvicorn miraiwerk.asgi:application --host 0.0.0.0 --port 4000

If the Django admin's static files have not been collected yet, run
`python manage.py collectstatic --noinput` once (or export
DJANGO_COLLECT_STATIC=1 before starting, which is a convenience for dev only).
"""

import os

# The API uses the synchronous Django ORM inside FastAPI's threadpool. Django
# refuses sync ORM calls whenever a loop is running in the current thread, so
# the ASGI process opts out of that guard explicitly. manage.py and tests keep
# the guard. Set DJANGO_ALLOW_ASYNC_UNSAFE=1 in the environment to keep this
# behaviour outside this module.
os.environ.setdefault("DJANGO_ALLOW_ASYNC_UNSAFE", "true")

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "miraiwerk.settings")
django.setup()

from django.core.asgi import get_asgi_application  # noqa: E402

from api.app import create_app  # noqa: E402

_django_admin_app = get_asgi_application()
_fastapi_app = create_app()


class PrefixRouter:
    """Route requests to the right sub-application by path prefix."""

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "/")
            if path == "/admin" or path.startswith("/admin/") or path.startswith("/static/"):
                await _django_admin_app(scope, receive, send)
                return
        await _fastapi_app(scope, receive, send)


application = PrefixRouter()

if os.environ.get("DJANGO_COLLECT_STATIC", "").lower() in {"1", "true", "yes"}:
    from django.core.management import call_command

    call_command("collectstatic", "--noinput", verbosity=0)
