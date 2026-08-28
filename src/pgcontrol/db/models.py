from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="viewer")  # admin | operator | viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ConnectionProfile(Base):
    __tablename__ = "connection_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer, default=5432)
    database: Mapped[str] = mapped_column(String(128), default="postgres")
    username: Mapped[str] = mapped_column(String(128))
    password_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    sslmode: Mapped[str] = mapped_column(String(16), default="prefer")
    sslrootcert: Mapped[str | None] = mapped_column(String(512), nullable=True)
    connect_timeout: Mapped[int] = mapped_column(Integer, default=10)
    read_only: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("connection_profiles.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MetricSample(Base):
    __tablename__ = "metric_samples"
    __table_args__ = (Index("ix_metric_samples_profile_time", "profile_id", "taken_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("connection_profiles.id", ondelete="CASCADE")
    )
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    connections: Mapped[int] = mapped_column(Integer)
    active: Mapped[int] = mapped_column(Integer)
    idle_in_transaction: Mapped[int] = mapped_column(Integer)
    waiting: Mapped[int] = mapped_column(Integer)
    longest_xact_seconds: Mapped[float] = mapped_column(Float)
    xact_commit: Mapped[int] = mapped_column(BigInteger)
    xact_rollback: Mapped[int] = mapped_column(BigInteger)
    blks_hit: Mapped[int] = mapped_column(BigInteger)
    blks_read: Mapped[int] = mapped_column(BigInteger)
    deadlocks: Mapped[int] = mapped_column(BigInteger)
    temp_bytes: Mapped[int] = mapped_column(BigInteger)
    db_bytes: Mapped[int] = mapped_column(BigInteger)
    wal_bytes: Mapped[int] = mapped_column(BigInteger)
    standby_count: Mapped[int] = mapped_column(Integer)
    lag_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    oldest_xid_age: Mapped[int] = mapped_column(BigInteger)
