import pytest
from cryptography.exceptions import InvalidTag

from pgcontrol.security.crypto import SecretBox
from pgcontrol.security.passwords import hash_password, verify_password


def test_secretbox_roundtrip():
    box = SecretBox("a-sufficiently-long-secret")
    blob = box.encrypt("p@ss wörd")
    assert blob != b"p@ss w\xc3\xb6rd"
    assert box.decrypt(blob) == "p@ss wörd"


def test_secretbox_wrong_key_fails():
    blob = SecretBox("a-sufficiently-long-secret").encrypt("x")
    with pytest.raises(InvalidTag):
        SecretBox("another-sufficiently-long-secret").decrypt(blob)


def test_secretbox_rejects_short_key():
    with pytest.raises(ValueError):
        SecretBox("short")


def test_password_hashing():
    h = hash_password("hunter2")
    assert verify_password(h, "hunter2")
    assert not verify_password(h, "hunter3")
