import psycopg

from pgcontrol.pg.catalog import perf


class _Cursor:
    def __init__(self, row):
        self.row = row

    async def fetchone(self):
        return self.row


class _OldExtensionConn:
    """pg_stat_statements 1.8 objects: the statements query references missing columns."""

    async def execute(self, query, params=None):
        if "pg_extension" in str(query):
            return _Cursor({"extversion": "1.8", "nspname": "public"})
        raise psycopg.errors.UndefinedColumn("column s.toplevel does not exist")


async def test_old_pg_stat_statements_explains_update():
    r = await perf.list_statements(_OldExtensionConn())  # type: ignore[arg-type]
    assert not r.available
    assert "1.8" in r.reason and "ALTER EXTENSION pg_stat_statements UPDATE" in r.reason
