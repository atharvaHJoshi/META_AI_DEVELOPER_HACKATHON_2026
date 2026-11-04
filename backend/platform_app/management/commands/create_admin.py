"""Create or promote a MIRAIWERK platform administrator.

The product stores its own Argon2id/scrypt password hashes and does not use
Django's ``AbstractBaseUser``, so ``createsuperuser`` cannot provision a usable
account. This command creates (or promotes) a user in the product ``users``
table with ``is_staff`` and ``is_platform_admin`` set, hashing the password with
the same code path as registration.
"""

from __future__ import annotations

from getpass import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from core.common import new_id
from platform_app.passwords import hash_password, password_problem


class Command(BaseCommand):
    help = "Create or promote a platform administrator who can sign in to /admin."

    def add_arguments(self, parser):
        parser.add_argument("--email", help="Admin email (prompted when omitted).")
        parser.add_argument("--name", help="Display name (prompted when omitted).")
        parser.add_argument(
            "--password",
            help="Password (prompted when omitted; avoid passing secrets in shell history).",
        )

    def handle(self, *args, **options):
        email = (options.get("email") or input("Email: ")).strip().lower()
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise CommandError("Enter a valid email address.")

        name = (options.get("name") or input("Full name: ")).strip()
        if len(name) < 2:
            raise CommandError("Enter a full name.")

        password = options.get("password")
        if not password:
            password = getpass("Password: ")
            confirm = getpass("Password (again): ")
            if password != confirm:
                raise CommandError("Passwords do not match.")
        problem = password_problem(password)
        if problem:
            raise CommandError(problem)

        password_hash = hash_password(password)
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE lower(email) = %s", [email])
            row = cursor.fetchone()
            if row:
                user_id = row[0]
                cursor.execute(
                    """
                    UPDATE users
                    SET name = %s,
                        password_hash = %s,
                        status = 'active',
                        is_staff = true,
                        is_platform_admin = true,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    [name, password_hash, user_id],
                )
                self.stdout.write(
                    self.style.SUCCESS(f"Promoted {email} to platform administrator ({user_id}).")
                )
            else:
                user_id = new_id("usr")
                cursor.execute(
                    """
                    INSERT INTO users
                      (id, name, email, title, avatar_color, password_hash, status,
                       is_platform_admin, is_staff)
                    VALUES (%s, %s, %s, '', '#5B6CFF', %s, 'active', true, true)
                    """,
                    [user_id, name, email, password_hash],
                )
                self.stdout.write(
                    self.style.SUCCESS(f"Created platform administrator {email} ({user_id}).")
                )
