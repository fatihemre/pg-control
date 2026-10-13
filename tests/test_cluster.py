import pytest

from pgcontrol.pg.catalog.cluster import _redact


@pytest.mark.parametrize(
    "conninfo",
    [
        "host=a user=rep password=secret",
        "host=a user=rep password = secret",
        "host=a user=rep password='sec ret' port=5432",
        "postgresql://rep:secret@a:5432/db?sslmode=require",
    ],
)
def test_redact_hides_password(conninfo: str):
    out = _redact(conninfo)
    assert "secret" not in out and "sec ret" not in out
    assert "password=***" in out
    assert "user=rep" in out


def test_redact_passthrough():
    assert _redact(None) is None
    assert _redact("") is None
    assert _redact("host=a port=5432") == "host=a port=5432"
    assert "secret" not in _redact("password='secret")
