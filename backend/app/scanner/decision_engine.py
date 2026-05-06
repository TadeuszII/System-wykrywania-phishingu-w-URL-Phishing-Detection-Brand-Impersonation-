from dataclasses import dataclass
from typing import Literal

Decision = Literal["ALLOW", "WARN", "BLOCK"]


@dataclass(frozen=True)
class DecisionResult:
    risk_score: int
    decision: Decision
    reasons: list[str]
    matched_brand: str | None


def decide_from_score(score: int) -> Decision:
    if score <= 29:
        return "ALLOW"
    if score <= 69:
        return "WARN"
    return "BLOCK"


def build_decision(
    rule_score: int,
    rule_reasons: list[str],
    brand_penalty: int,
    brand_reasons: list[str],
    ml_score: float,
    matched_brand: str | None,
) -> DecisionResult:
    final_score = min(100, int(rule_score) + int(brand_penalty) + round(float(ml_score) * 10))
    reasons = merge_reasons(rule_reasons, brand_reasons)

    return DecisionResult(
        risk_score=final_score,
        decision=decide_from_score(final_score),
        reasons=reasons,
        matched_brand=matched_brand,
    )


def merge_reasons(*reason_groups: list[str]) -> list[str]:
    merged: list[str] = []
    for group in reason_groups:
        for reason in group:
            if reason == "No suspicious patterns detected" and merged:
                continue
            if reason not in merged:
                merged.append(reason)
    return merged or ["No suspicious patterns detected"]
