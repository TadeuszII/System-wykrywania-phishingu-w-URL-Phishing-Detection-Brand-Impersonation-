from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Decision = Literal["ALLOW", "WARN", "BLOCK"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ScanRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    context: str | None = Field(default=None, max_length=200)


class ScanResult(BaseModel):
    risk_score: int = Field(..., ge=0, le=100)
    decision: Decision
    reasons: list[str]
    matched_brand: str | None = None
    timestamp: datetime = Field(default_factory=utc_now)


class BrandProfile(BaseModel):
    brand_name: str = Field(..., min_length=1, max_length=120)
    official_domains: list[str] = Field(..., min_length=1)
    keywords: list[str] = Field(..., min_length=1)

    model_config = ConfigDict(from_attributes=True)


class AuditLog(BaseModel):
    timestamp: datetime
    url: str
    decision: Decision
    risk_score: int = Field(..., ge=0, le=100)
    reasons: list[str]
    source: str
    request_hash: str
    chain_hash: str

    model_config = ConfigDict(from_attributes=True)


class AuditLogPage(BaseModel):
    items: list[AuditLog]
    page: int
    limit: int
    total: int


class VTRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class VTResult(BaseModel):
    vt_decision: Decision
    engines_total: int = Field(..., ge=0)
    engines_flagged: int = Field(..., ge=0)
    engines_clean: int = Field(..., ge=0)
    vt_categories: list[str] = Field(default_factory=list)
    vt_permalink: str | None = None


class ScanResultORM(Base):
    __tablename__ = "scan_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(String(200), nullable=True)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    matched_brand: Mapped[str | None] = mapped_column(String(120), nullable=True)


class BrandProfileORM(Base):
    __tablename__ = "brand_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_name: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    official_domains: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    keywords: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AuditLogORM(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    chain_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
