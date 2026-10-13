from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()


@cache
def _dummy_hash() -> str:
    return _hasher.hash("pgcontrol-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def verify_dummy_password(password: str) -> bool:
    """Spend as long as a real check so failed logins don't reveal which usernames exist."""
    verify_password(_dummy_hash(), password)
    return False
