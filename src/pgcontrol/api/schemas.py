from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SslMode = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str


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


class ProfileCreate(ProfileBase):
    password: str | None = None


class ProfileUpdate(ProfileBase):
    # None = keep existing password, "" = clear it, otherwise replace
    password: str | None = None


class ProfileOut(ProfileBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    has_password: bool
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
