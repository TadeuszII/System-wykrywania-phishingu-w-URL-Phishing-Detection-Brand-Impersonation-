import math
import re
from collections import Counter
from dataclasses import dataclass
from ipaddress import ip_address
from urllib.parse import urlparse

SUSPICIOUS_TLDS = {
    "xyz",
    "tk",
    "ml",
    "ga",
    "cf",
    "gq",
    "top",
    "click",
    "link",
    "download",
    "win",
    "loan",
    "icu",
    "pw",
}

SUSPICIOUS_KEYWORDS = {
    "login",
    "verify",
    "account",
    "update",
    "secure",
    "banking",
    "confirm",
    "password",
    "credential",
    "reset",
    "billing",
    "payment",
    "wallet",
    "support",
}

URL_SHORTENERS = {
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "ow.ly",
    "is.gd",
    "buff.ly",
    "cutt.ly",
    "rb.gy",
    "shorturl.at",
    "tiny.cc",
    "t.ly",
}

FREE_HOSTING_DOMAINS = {
    "pages.dev",
    "vercel.app",
    "web.app",
    "firebaseapp.com",
    "wixstudio.com",
    "netlify.app",
    "workers.dev",
    "github.io",
}


@dataclass(frozen=True)
class RuleAnalysis:
    rule_score: int
    reasons: list[str]
    is_valid_url: bool


def shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def normalize_url(url: str) -> str:
    value = str(url).strip()
    if not value:
        return value
    if "://" not in value:
        return f"http://{value}"
    return value


def is_ip_address(hostname: str) -> bool:
    try:
        ip_address(hostname)
        return True
    except ValueError:
        return False


def get_tld(hostname: str) -> str:
    parts = hostname.rsplit(".", 1)
    return parts[1].lower() if len(parts) == 2 and parts[1] else ""


def count_subdomains(hostname: str) -> int:
    parts = [part for part in hostname.split(".") if part]
    if len(parts) <= 2:
        return 0
    return len(parts) - 2


def add_rule(score: int, reasons: list[str], points: int, reason: str) -> int:
    reasons.append(reason)
    return min(100, score + points)


def is_free_hosting_domain(hostname: str) -> bool:
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in FREE_HOSTING_DOMAINS)


def matched_free_hosting_domain(hostname: str) -> str | None:
    for domain in FREE_HOSTING_DOMAINS:
        if hostname == domain or hostname.endswith(f".{domain}"):
            return domain
    return None


def free_hosting_subdomain(hostname: str, hosting_domain: str) -> str:
    if hostname == hosting_domain:
        return ""
    return hostname[: -(len(hosting_domain) + 1)]


def has_long_numeric_path_token(path: str) -> bool:
    return any(re.fullmatch(r"\d{10,}", segment) for segment in path.split("/") if segment)


def has_support_themed_path(path: str) -> bool:
    segments = {segment.lower() for segment in path.split("/") if segment}
    return bool(segments.intersection({"help", "contact", "support"}))


def analyze_url(url: str) -> RuleAnalysis:
    reasons: list[str] = []
    score = 0

    normalized_url = normalize_url(url)
    parsed = urlparse(normalized_url)
    hostname = (parsed.hostname or "").strip(".").lower()

    if parsed.scheme not in {"http", "https"} or not hostname or "." not in hostname:
        return RuleAnalysis(
            rule_score=30,
            reasons=["Invalid URL format"],
            is_valid_url=False,
        )

    tld = get_tld(hostname)
    path_and_query = f"{parsed.path}?{parsed.query}".lower()
    domain_without_tld = hostname.rsplit(".", 1)[0]

    if tld in SUSPICIOUS_TLDS:
        score = add_rule(score, reasons, 15, "Suspicious TLD detected")

    if len(normalized_url) > 100:
        score = add_rule(score, reasons, 10, "Long URL detected")

    if count_subdomains(hostname) > 3:
        score = add_rule(score, reasons, 15, "Too many subdomains")

    if "@" in normalized_url:
        score = add_rule(score, reasons, 20, "At-sign found in URL")

    if re.search(r"/{2,}", parsed.path):
        score = add_rule(score, reasons, 10, "Multiple slashes in path")

    if "-" in domain_without_tld:
        score = add_rule(score, reasons, 10, "Hyphenated domain detected")

    for keyword in sorted(SUSPICIOUS_KEYWORDS):
        if keyword in path_and_query or keyword in hostname:
            score = add_rule(score, reasons, 15, f"Suspicious keyword detected: {keyword}")

    if shannon_entropy(domain_without_tld) > 3.5:
        score = add_rule(score, reasons, 20, "High domain entropy")

    if is_ip_address(hostname):
        score = add_rule(score, reasons, 25, "IP address used instead of domain")

    if hostname in URL_SHORTENERS:
        score = add_rule(score, reasons, 20, "URL shortener detected")

    free_hosting_domain = matched_free_hosting_domain(hostname)
    if free_hosting_domain:
        score = add_rule(score, reasons, 10, "Commonly abused free hosting platform detected")
        subdomain = free_hosting_subdomain(hostname, free_hosting_domain)
        if subdomain and ("-" in subdomain or shannon_entropy(subdomain) > 3.5):
            score = add_rule(score, reasons, 15, "Suspicious free-hosting subdomain detected")
        if has_support_themed_path(parsed.path):
            score = add_rule(score, reasons, 10, "Support-themed path on free hosting platform")

    if has_long_numeric_path_token(parsed.path):
        score = add_rule(score, reasons, 10, "Long numeric path token detected")

    if "xn--" in hostname:
        score = add_rule(score, reasons, 25, "Punycode or IDN domain detected")

    if not tld:
        score = add_rule(score, reasons, 30, "Missing TLD")

    if not reasons:
        reasons.append("No suspicious patterns detected")

    return RuleAnalysis(
        rule_score=min(score, 100),
        reasons=reasons,
        is_valid_url=True,
    )
