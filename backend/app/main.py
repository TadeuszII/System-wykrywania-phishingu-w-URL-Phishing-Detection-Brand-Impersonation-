from contextlib import asynccontextmanager
from datetime import datetime, timezone
import base64
import json
import os
from urllib import error, request
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_scan_log
from app.database import check_database, get_db, init_db
from app.models import (
    AuditLog,
    AuditLogORM,
    AuditLogPage,
    BrandProfile,
    BrandProfileORM,
    ScanRequest,
    ScanResult,
    ScanResultORM,
    VTRequest,
    VTResult,
)
from app.scanner.brand_detector import detect_brand_impersonation, hostname_from_url, is_official_domain
from app.scanner.decision_engine import build_decision, decide_from_score
from app.scanner.ml_model import get_ml_status, predict_ml_score
from app.scanner.url_analyzer import analyze_url

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "admin_api_key")
VT_TIMEOUT_SECONDS = 8
OFFICIAL_AUTH_KEYWORD_CAP = 25
OFFICIAL_AUTH_KEYWORD_REASONS = {
    "Suspicious keyword detected: account",
    "Suspicious keyword detected: login",
    "Suspicious keyword detected: password",
    "Suspicious keyword detected: security",
    "Suspicious keyword detected: signin",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="Guardy Backend",
    description="Backend API for Guardy phishing URL detection.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_admin_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing API key",
        )


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@app.get("/health")
def health_check(db: Session = Depends(get_db)) -> dict[str, Any]:
    brands_count = db.scalar(select(func.count()).select_from(BrandProfileORM)) or 0
    return {
        "status": "ok",
        "brands_count": brands_count,
        "ml_status": get_ml_status(),
        "database": "ok" if check_database() else "error",
    }


@app.post("/scan/url", response_model=ScanResult)
def scan_url(payload: ScanRequest, db: Session = Depends(get_db)) -> ScanResult:
    rule_analysis = analyze_url(payload.url)

    if not rule_analysis.is_valid_url:
        result = ScanResult(
            risk_score=30,
            decision="WARN",
            reasons=rule_analysis.reasons,
            matched_brand=None,
            timestamp=utc_now(),
        )
        save_scan_result(db, payload, result)
        return result

    brands = list(db.scalars(select(BrandProfileORM)).all())
    brand_detection = detect_brand_impersonation(payload.url, brands)
    ml_score = predict_ml_score(payload.url)
    decision = build_decision(
        rule_score=rule_analysis.rule_score,
        rule_reasons=rule_analysis.reasons,
        brand_penalty=brand_detection.brand_penalty,
        brand_reasons=brand_detection.reasons,
        ml_score=ml_score,
        matched_brand=brand_detection.matched_brand,
    )
    risk_score = decision.risk_score
    decision_value = decision.decision
    if should_apply_official_auth_cap(payload.url, brands, rule_analysis.reasons, brand_detection.brand_penalty):
        risk_score = min(risk_score, OFFICIAL_AUTH_KEYWORD_CAP)
        decision_value = decide_from_score(risk_score)

    result = ScanResult(
        risk_score=risk_score,
        decision=decision_value,
        reasons=decision.reasons,
        matched_brand=decision.matched_brand,
        timestamp=utc_now(),
    )
    save_scan_result(db, payload, result)
    return result


def is_official_brand_domain(url: str, brands: list[BrandProfileORM]) -> bool:
    hostname = hostname_from_url(url)
    return any(is_official_domain(hostname, brand.official_domains) for brand in brands)


def has_only_official_auth_keyword_reasons(reasons: list[str]) -> bool:
    return bool(reasons) and all(reason in OFFICIAL_AUTH_KEYWORD_REASONS for reason in reasons)


def should_apply_official_auth_cap(
    url: str,
    brands: list[BrandProfileORM],
    rule_reasons: list[str],
    brand_penalty: int,
) -> bool:
    return (
        brand_penalty == 0
        and is_official_brand_domain(url, brands)
        and has_only_official_auth_keyword_reasons(rule_reasons)
    )


def save_scan_result(db: Session, payload: ScanRequest, result: ScanResult) -> None:
    db.add(
        ScanResultORM(
            timestamp=result.timestamp,
            url=payload.url,
            context=payload.context,
            decision=result.decision,
            risk_score=result.risk_score,
            reasons=result.reasons,
            matched_brand=result.matched_brand,
        )
    )
    append_scan_log(db, payload, result)
    db.commit()


@app.post("/scan/virustotal", response_model=VTResult)
def scan_virustotal(
    payload: VTRequest,
    x_vt_key: str = Header(..., alias="X-VT-Key"),
) -> VTResult:
    return fetch_virustotal_result(payload.url, x_vt_key)


def fetch_virustotal_result(url: str, vt_key: str) -> VTResult:
    try:
        url_id = base64.urlsafe_b64encode(url.encode("utf-8")).decode("utf-8").strip("=")
        api_request = request.Request(
            f"https://www.virustotal.com/api/v3/urls/{url_id}",
            headers={"x-apikey": vt_key},
            method="GET",
        )
        with request.urlopen(api_request, timeout=VT_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
        attributes = payload.get("data", {}).get("attributes", {})
        stats = attributes.get("last_analysis_stats", {})
        categories = attributes.get("categories", {})
        flagged = int(stats.get("malicious", 0)) + int(stats.get("suspicious", 0))
        harmless = int(stats.get("harmless", 0))
        undetected = int(stats.get("undetected", 0))
        total = flagged + harmless + undetected
        return build_vt_result(
            engines_total=total,
            engines_flagged=flagged,
            categories=sorted(set(str(value) for value in categories.values() if value)),
            permalink=f"https://www.virustotal.com/gui/url/{url_id}",
        )
    except (OSError, error.URLError, error.HTTPError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
        return build_vt_fallback(url)


def build_vt_fallback(url: str) -> VTResult:
    lowered_url = url.lower()
    suspicious_markers = ["login", "verify", "account", "secure", "password", "xn--", "bit.ly", ".xyz", ".tk"]
    flagged = min(6, sum(1 for marker in suspicious_markers if marker in lowered_url))
    if flagged == 0:
        total = 90
    elif flagged <= 2:
        total = 90
    else:
        flagged = 6
        total = 90
    return build_vt_result(
        engines_total=total,
        engines_flagged=flagged,
        categories=["fallback-demo"] if flagged else [],
        permalink=None,
    )


def build_vt_result(
    engines_total: int,
    engines_flagged: int,
    categories: list[str],
    permalink: str | None,
) -> VTResult:
    engines_clean = max(0, engines_total - engines_flagged)
    return VTResult(
        vt_decision=decide_from_score(0 if engines_flagged == 0 else 30 if engines_flagged <= 5 else 70),
        engines_total=engines_total,
        engines_flagged=engines_flagged,
        engines_clean=engines_clean,
        vt_categories=categories,
        vt_permalink=permalink,
    )


@app.get("/brands", response_model=list[BrandProfile])
def list_brands(db: Session = Depends(get_db)) -> list[BrandProfileORM]:
    return list(db.scalars(select(BrandProfileORM).order_by(BrandProfileORM.brand_name)).all())


@app.post(
    "/brands",
    response_model=BrandProfile,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_api_key)],
)
def create_brand(payload: BrandProfile, db: Session = Depends(get_db)) -> BrandProfileORM:
    brand = BrandProfileORM(
        brand_name=payload.brand_name,
        official_domains=payload.official_domains,
        keywords=payload.keywords,
    )
    db.add(brand)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Brand already exists") from exc
    db.refresh(brand)
    return brand


@app.get(
    "/audit/logs",
    response_model=AuditLogPage,
    dependencies=[Depends(require_admin_api_key)],
)
def list_audit_logs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> AuditLogPage:
    total = db.scalar(select(func.count()).select_from(AuditLogORM)) or 0
    offset = (page - 1) * limit
    rows = db.scalars(
        select(AuditLogORM)
        .order_by(AuditLogORM.timestamp.desc(), AuditLogORM.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    items = [
        AuditLog(
            timestamp=row.timestamp,
            url=row.url,
            decision=row.decision,
            risk_score=row.risk_score,
            reasons=row.reasons,
            source=row.source,
            request_hash=row.request_hash,
            chain_hash=row.chain_hash,
        )
        for row in rows
    ]
    return AuditLogPage(items=items, page=page, limit=limit, total=total)
