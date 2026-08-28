"""Encryption of secrets at rest (connection passwords) using AES-256-GCM.

Key is derived from PGCONTROL_SECRET_KEY with HKDF so any long random string works.
Ciphertext layout: 1 byte version | 12 byte nonce | ciphertext+tag.
"""

import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_VERSION = b"\x01"
_NONCE_LEN = 12


class SecretBox:
    def __init__(self, secret_key: str) -> None:
        if len(secret_key) < 16:
            raise ValueError("PGCONTROL_SECRET_KEY must be at least 16 characters")
        self._key = HKDF(
            algorithm=hashes.SHA256(), length=32, salt=None, info=b"pgcontrol-secrets-v1"
        ).derive(secret_key.encode())

    def encrypt(self, plaintext: str) -> bytes:
        nonce = os.urandom(_NONCE_LEN)
        ct = AESGCM(self._key).encrypt(nonce, plaintext.encode(), _VERSION)
        return _VERSION + nonce + ct

    def decrypt(self, blob: bytes) -> str:
        if not blob or blob[:1] != _VERSION:
            raise ValueError("Unsupported ciphertext version")
        nonce, ct = blob[1 : 1 + _NONCE_LEN], blob[1 + _NONCE_LEN :]
        return AESGCM(self._key).decrypt(nonce, ct, _VERSION).decode()
