import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLogORM, ScanRequest, ScanResult

GENESIS_HASH = "GENESIS"
DEFAULT_SCAN_SOURCE = "api_direct"
CONTEXT_SOURCE_MAP = {
    "clicked_link": "chrome_extension/clicked_link",
    "manual_popup": "chrome_extension/manual_popup",
    "test_suite": "test_suite",
    "seed": "seed",
    "batch_scan": "batch_scan",
}


def isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_request_hash(url: str, timestamp: datetime) -> str:
    return sha256_hex(canonical_json({"url": url, "timestamp": isoformat(timestamp)}))


def build_audit_payload(
    url: str,
    timestamp: datetime,
    decision: str,
    risk_score: int,
    reasons: list[str],
    source: str,
    request_hash: str,
) -> dict:
    return {
        "timestamp": isoformat(timestamp),
        "url": url,
        "decision": decision,
        "risk_score": risk_score,
        "reasons": reasons,
        "source": source,
        "request_hash": request_hash,
    }


def build_chain_hash(previous_chain_hash: str, payload: dict) -> str:
    return sha256_hex(previous_chain_hash + canonical_json(payload))


def get_previous_chain_hash(db: Session) -> str:
    latest = db.scalar(select(AuditLogORM).order_by(AuditLogORM.id.desc()).limit(1))
    return latest.chain_hash if latest else GENESIS_HASH


def resolve_source(context: str | None) -> str:
    if context is None:
        return DEFAULT_SCAN_SOURCE

    normalized_context = context.strip().lower()
    if not normalized_context:
        return DEFAULT_SCAN_SOURCE

    return CONTEXT_SOURCE_MAP.get(normalized_context, DEFAULT_SCAN_SOURCE)


def append_scan_log(
    db: Session,
    request_payload: ScanRequest,
    result: ScanResult,
) -> AuditLogORM:
    source = resolve_source(request_payload.context)
    request_hash = build_request_hash(request_payload.url, result.timestamp)
    audit_payload = build_audit_payload(
        url=request_payload.url,
        timestamp=result.timestamp,
        decision=result.decision,
        risk_score=result.risk_score,
        reasons=result.reasons,
        source=source,
        request_hash=request_hash,
    )
    chain_hash = build_chain_hash(get_previous_chain_hash(db), audit_payload)
    log = AuditLogORM(
        timestamp=result.timestamp,
        url=request_payload.url,
        decision=result.decision,
        risk_score=result.risk_score,
        reasons=result.reasons,
        source=source,
        request_hash=request_hash,
        chain_hash=chain_hash,
    )
    db.add(log)
    return log


def verify_chain(db: Session) -> bool:
    previous_chain_hash = GENESIS_HASH
    rows = db.scalars(select(AuditLogORM).order_by(AuditLogORM.id.asc())).all()

    for row in rows:
        expected_request_hash = build_request_hash(row.url, row.timestamp)
        if row.request_hash != expected_request_hash:
            return False

        payload = build_audit_payload(
            url=row.url,
            timestamp=row.timestamp,
            decision=row.decision,
            risk_score=row.risk_score,
            reasons=row.reasons,
            source=row.source,
            request_hash=row.request_hash,
        )
        expected_chain_hash = build_chain_hash(previous_chain_hash, payload)
        if row.chain_hash != expected_chain_hash:
            return False
        previous_chain_hash = row.chain_hash

    return True
