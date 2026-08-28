import pytest

from pgcontrol.config import Settings, normalize_database_url


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgresql://u:p@db:5432/meta", "postgresql+psycopg://u:p@db:5432/meta"),
        ("postgres://u:p@db/meta", "postgresql+psycopg://u:p@db/meta"),
        (
            "POSTGRESQL://u@db/meta?sslmode=require",
            "postgresql+psycopg://u@db/meta?sslmode=require",
        ),
        ("postgresql+psycopg://u@db/meta", "postgresql+psycopg://u@db/meta"),
        ("sqlite:////var/lib/pgcontrol/meta.db", "sqlite+aiosqlite:////var/lib/pgcontrol/meta.db"),
        ("  sqlite+aiosqlite:///x.db ", "sqlite+aiosqlite:///x.db"),
    ],
)
def test_normalize_database_url(given, expected):
    assert normalize_database_url(given) == expected


@pytest.mark.parametrize("bad", ["mysql://u@db/x", "postgresql+asyncpg://u@db/x", "not-a-url"])
def test_normalize_database_url_rejects(bad):
    with pytest.raises(ValueError):
        normalize_database_url(bad)


def test_settings_default_to_sqlite(tmp_path):
    s = Settings(secret_key="k", data_dir=tmp_path, database_url=None, _env_file=None)
    assert s.uses_sqlite
    assert s.sqlalchemy_url == f"sqlite+aiosqlite:///{tmp_path / 'pgcontrol.db'}"
    blank = Settings(secret_key="k", data_dir=tmp_path, database_url="  ", _env_file=None)
    assert blank.uses_sqlite


def test_settings_postgres_url(tmp_path):
    s = Settings(secret_key="k", database_url="postgresql://u:p@h/meta", _env_file=None)
    assert not s.uses_sqlite
    assert s.sqlalchemy_url == "postgresql+psycopg://u:p@h/meta"
