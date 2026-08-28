from psycopg import AsyncConnection

PUBLIC_OID = 0
PUBLIC_NAME = "PUBLIC"


async def server_version_num(conn: AsyncConnection) -> int:
    row = await (
        await conn.execute("SELECT current_setting('server_version_num')::int AS v")
    ).fetchone()
    assert row is not None
    return int(row["v"])


def is_system_role(name: str) -> bool:
    return name.startswith("pg_")


def is_system_schema(name: str) -> bool:
    return name.startswith("pg_") or name == "information_schema"
