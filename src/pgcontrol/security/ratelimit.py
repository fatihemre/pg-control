"""In-memory brute-force protection for the login endpoint.

PgControl runs as a single process, so a process-local sliding window is enough: after
``max_attempts`` failures for the same key (client IP or username) inside ``window``
seconds, further attempts are refused for ``lockout`` seconds. Successful logins clear
the username's counter but not the IP's, so a guessed password does not reset an attacker.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field


@dataclass
class _Bucket:
    failures: deque[float] = field(default_factory=deque)
    locked_until: float = 0.0


class LoginLimiter:
    def __init__(self, max_attempts: int = 5, window: int = 300, lockout: int = 300) -> None:
        self.max_attempts = max(1, max_attempts)
        self.window = max(1, window)
        self.lockout = max(1, lockout)
        self._buckets: dict[str, _Bucket] = {}

    def _bucket(self, key: str, now: float) -> _Bucket:
        b = self._buckets.setdefault(key, _Bucket())
        while b.failures and b.failures[0] <= now - self.window:
            b.failures.popleft()
        return b

    def retry_after(self, *keys: str) -> int:
        """Seconds until any of ``keys`` may try again (0 = allowed now)."""
        now = time.monotonic()
        wait = 0.0
        for key in keys:
            b = self._bucket(key, now)
            if b.locked_until > now:
                wait = max(wait, b.locked_until - now)
        return int(wait) + 1 if wait > 0 else 0

    def record_failure(self, *keys: str) -> bool:
        """Register a failed attempt; returns True when this failure triggered a lockout."""
        now = time.monotonic()
        locked = False
        for key in keys:
            b = self._bucket(key, now)
            b.failures.append(now)
            if len(b.failures) >= self.max_attempts and b.locked_until <= now:
                b.locked_until = now + self.lockout
                b.failures.clear()
                locked = True
        return locked

    def reset(self, *keys: str) -> None:
        for key in keys:
            self._buckets.pop(key, None)

    def clear(self) -> None:
        self._buckets.clear()

    def prune(self) -> None:
        """Drop idle buckets so the map cannot grow without bound."""
        now = time.monotonic()
        for key in list(self._buckets):
            b = self._bucket(key, now)
            if not b.failures and b.locked_until <= now:
                del self._buckets[key]
