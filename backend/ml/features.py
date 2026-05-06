import math
import re
from collections import Counter
from ipaddress import ip_address
from urllib.parse import parse_qs, urlparse

SUSPICIOUS_TLDS = {"xyz", "tk", "ml", "ga", "cf", "gq", "top", "click", "icu", "pw"}
SUSPICIOUS_KEYWORDS = {"login", "verify", "account", "update", "secure", "banking", "password", "reset"}
URL_SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rb.gy"}

FEATURE_NAMES = [
    "url_length",
    "domain_length",
    "subdomain_count",
    "domain_hyphen_count",
    "domain_digit_count",
    "domain_entropy",
    "special_char_count",
    "is_ip_address",
    "has_punycode",
    "has_suspicious_tld",
    "has_suspicious_keyword",
    "path_length",
    "query_param_count",
    "uses_https",
    "is_url_shortener",
]


def normalize_url(url: str) -> str:
    value = str(url).strip()
    if value and "://" not in value:
        return f"http://{value}"
    return value


def shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def get_tld(hostname: str) -> str:
    parts = hostname.rsplit(".", 1)
    return parts[1].lower() if len(parts) == 2 else ""


def is_ip(hostname: str) -> int:
    try:
        ip_address(hostname)
        return 1
    except ValueError:
        return 0


def extract_features(url: str) -> list[float]:
    normalized_url = normalize_url(url)
    parsed = urlparse(normalized_url)
    hostname = (parsed.hostname or "").lower()
    domain_parts = [part for part in hostname.split(".") if part]
    root_label = domain_parts[-2] if len(domain_parts) >= 2 else hostname
    subdomain_count = max(0, len(domain_parts) - 2)
    path_query = f"{parsed.path}?{parsed.query}".lower()

    return [
        len(normalized_url),
        len(hostname),
        subdomain_count,
        root_label.count("-"),
        sum(char.isdigit() for char in root_label),
        round(shannon_entropy(root_label), 4),
        sum(normalized_url.count(char) for char in ["@", "/", "=", "?", "&", "%", "-"]),
        is_ip(hostname),
        1 if "xn--" in hostname else 0,
        1 if get_tld(hostname) in SUSPICIOUS_TLDS else 0,
        1 if any(keyword in path_query or keyword in hostname for keyword in SUSPICIOUS_KEYWORDS) else 0,
        len(parsed.path or ""),
        len(parse_qs(parsed.query or "")),
        1 if parsed.scheme == "https" else 0,
        1 if hostname in URL_SHORTENERS else 0,
    ]
