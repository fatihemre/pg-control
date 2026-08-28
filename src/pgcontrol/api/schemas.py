from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SslMode = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    auth_provider: str = "local"


class ProfileBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(default="postgres", min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=128)
    sslmode: SslMode = "prefer"
    sslrootcert: str | None = None
    connect_timeout: int = Field(default=10, ge=1, le=120)
    read_only: bool = False
    patroni_url: str | None = Field(default=None, max_length=512)
    patroni_username: str | None = Field(default=None, max_length=128)

    @field_validator("patroni_url")
    @classmethod
    def _patroni_url(cls, v: str | None) -> str | None:
        v = (v or "").strip().rstrip("/")
        if not v:
            return None  # blank clears the Patroni integration
        if not v.startswith(("http://", "https://")):
            raise ValueError("Patroni URL must start with http:// or https://")
        return v


class ProfileCreate(ProfileBase):
    password: str | None = None
    patroni_password: str | None = None


class ProfileUpdate(ProfileBase):
    # None = keep existing password, "" = clear it, otherwise replace
    password: str | None = None
    patroni_password: str | None = None


class ProfileOut(ProfileBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    has_password: bool
    has_patroni_password: bool
    created_at: datetime
    updated_at: datetime


class ProfileTestRequest(ProfileBase):
    password: str | None = None


class ServerInfoOut(BaseModel):
    version: str
    version_num: int
    current_user: str
    is_superuser: bool
    in_recovery: bool
    databases: list[str]
