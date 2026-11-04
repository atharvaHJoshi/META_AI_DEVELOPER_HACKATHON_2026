"""Django auth backend that authenticates against the product's users table.

This lets staff sign in to the Django admin with the same Argon2id/scrypt
password hashes used by the MIRAIWERK API — no separate admin password store.
"""

from __future__ import annotations

from django.contrib.auth.backends import BaseBackend

from platform_app.models import User
from platform_app.passwords import verify_password


class PasswordHashBackend(BaseBackend):
    def authenticate(self, request, username: str | None = None, password: str | None = None, **kwargs):
        if not username or not password:
            return None
        try:
            user = User.objects.get(email__iexact=username.strip())
        except User.DoesNotExist:
            # Constant-ish shape: still run a verification to reduce user enumeration timing.
            verify_password(password, None)
            return None
        if not verify_password(password, user.password_hash):
            return None
        if user.status != "active":
            return None
        return user

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None

    def has_perm(self, user_obj, perm, obj=None):
        return bool(getattr(user_obj, "is_platform_admin", False))

    def has_module_perms(self, user_obj, app_label):
        return bool(getattr(user_obj, "is_platform_admin", False))
