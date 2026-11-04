"""Password hashing and verification.

Supports the two formats historically written by the Express service:

* Argon2id in standard PHC format (``$argon2id$v=19$m=...,t=2,p=1$...``)
* A scrypt fallback written as ``scrypt$<saltHex>$<hashHex>`` using
  Node's defaults (N=16384, r=8, p=1, 64-byte derived key)

New hashes are always Argon2id.
"""

from __future__ import annotations

import hashlib
import hmac
import re

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, VerificationError, VerifyMismatchError

# Matches @node-rs/argon2's options from the legacy implementation.
_hasher = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)

_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 64


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def _verify_scrypt(password: str, stored: str) -> bool:
    try:
        _, salt_hex, hash_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, TypeError):
        return False
    try:
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
            maxmem=64 * 1024 * 1024,
            dklen=len(expected) or _SCRYPT_DKLEN,
        )
    except (ValueError, NotImplementedError):
        return False
    return hmac.compare_digest(derived, expected)


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    if stored.startswith("scrypt$"):
        return _verify_scrypt(password, stored)
    try:
        return _hasher.verify(stored, password)
    except (VerifyMismatchError, VerificationError, Argon2Error):
        return False


def password_problem(password: str) -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        return "Password must include at least one letter and one number."
    return None
