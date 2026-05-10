from dataclasses import dataclass
import re
from urllib.parse import urlparse

WEAK_BRAND_KEYWORDS = {"live"}
GENERIC_LOOKALIKE_TOKENS = {
    "account",
    "auth",
    "billing",
    "login",
    "payment",
    "secure",
    "security",
    "support",
    "verify",
    "verification",
}


@dataclass(frozen=True)
class BrandInput:
    brand_name: str
    official_domains: list[str]
    keywords: list[str]


@dataclass(frozen=True)
class BrandDetection:
    brand_penalty: int
    matched_brand: str | None
    reasons: list[str]


def normalize_url(url: str) -> str:
    value = str(url).strip()
    if not value:
        return value
    if "://" not in value:
        return f"http://{value}"
    return value


def hostname_from_url(url: str) -> str:
    parsed = urlparse(normalize_url(url))
    return (parsed.hostname or "").strip(".").lower()


def registrable_domain(hostname: str) -> str:
    parts = [part for part in hostname.split(".") if part]
    if len(parts) < 2:
        return hostname
    return ".".join(parts[-2:])


def domain_label(domain: str) -> str:
    return domain.split(".", 1)[0].lower()


def is_official_domain(hostname: str, official_domains: list[str]) -> bool:
    normalized_domains = [domain.lower().strip(".") for domain in official_domains]
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in normalized_domains)


def levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)

    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            insert_cost = current[j - 1] + 1
            delete_cost = previous[j] + 1
            replace_cost = previous[j - 1] + (left_char != right_char)
            current.append(min(insert_cost, delete_cost, replace_cost))
        previous = current
    return previous[-1]


def add_signal(
    current_penalty: int,
    reasons: list[str],
    points: int,
    reason: str,
) -> int:
    if reason not in reasons:
        reasons.append(reason)
    return min(40, current_penalty + points)


def has_brand_specific_reason(reasons: list[str]) -> bool:
    return any(reason != "Punycode or IDN domain detected" for reason in reasons)


def hostname_tokens(hostname: str) -> set[str]:
    return {token for token in re.split(r"[^a-z0-9]+", hostname.lower()) if token}


def root_label_tokens(root_label: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", root_label.lower()) if len(token) >= 4]


def is_generic_lookalike_token(token: str) -> bool:
    return token in GENERIC_LOOKALIKE_TOKENS


def official_root_appears_as_subdomain(hostname: str, official_root: str) -> bool:
    return hostname.startswith(f"{official_root}.") or f".{official_root}." in hostname


def keyword_matches_hostname(keyword: str, hostname: str, root_label: str) -> bool:
    normalized_keyword = keyword.lower()
    compact_keyword = normalized_keyword.replace("-", "")
    if compact_keyword in WEAK_BRAND_KEYWORDS:
        return False

    compact_root = root_label.replace("-", "")
    tokens = hostname_tokens(hostname)

    if normalized_keyword in tokens or compact_keyword in tokens:
        return True

    if len(compact_keyword) >= 5:
        return normalized_keyword in hostname or ("-" not in normalized_keyword and compact_keyword in compact_root)

    return False


def token_lookalike_distance(token: str, official_label: str) -> int | None:
    if is_generic_lookalike_token(token) or token == official_label:
        return None

    distance = levenshtein_distance(token, official_label)
    allowed_distance = 2 if any(char.isdigit() for char in token) and len(official_label) >= 5 else 1
    return distance if distance <= allowed_distance else None


def coerce_brand(brand: BrandInput | dict | object) -> BrandInput:
    if isinstance(brand, BrandInput):
        return brand
    if isinstance(brand, dict):
        return BrandInput(
            brand_name=brand["brand_name"],
            official_domains=list(brand["official_domains"]),
            keywords=list(brand["keywords"]),
        )
    return BrandInput(
        brand_name=getattr(brand, "brand_name"),
        official_domains=list(getattr(brand, "official_domains")),
        keywords=list(getattr(brand, "keywords")),
    )


def detect_brand_impersonation(url: str, brands: list[BrandInput | dict | object]) -> BrandDetection:
    hostname = hostname_from_url(url)
    if not hostname:
        return BrandDetection(brand_penalty=0, matched_brand=None, reasons=[])

    coerced_brands = [coerce_brand(raw_brand) for raw_brand in brands]
    if any(is_official_domain(hostname, brand.official_domains) for brand in coerced_brands):
        return BrandDetection(brand_penalty=0, matched_brand=None, reasons=[])

    root_domain = registrable_domain(hostname)
    root_label = domain_label(root_domain)
    host_labels = hostname.split(".")
    is_punycode = "xn--" in hostname

    best_penalty = 0
    best_brand: str | None = None
    best_reasons: list[str] = []

    for brand in coerced_brands:
        penalty = 0
        reasons: list[str] = []
        official_domains = [domain.lower().strip(".") for domain in brand.official_domains]
        official_roots = [registrable_domain(domain) for domain in official_domains]
        official_labels = [domain_label(domain) for domain in official_roots]
        keywords = [keyword.lower() for keyword in brand.keywords]

        for official_root, official_label in zip(official_roots, official_labels, strict=False):
            if len(root_label) >= 4 and len(official_label) >= 4:
                distance = levenshtein_distance(root_label, official_label)
                if distance == 1:
                    penalty = add_signal(penalty, reasons, 30, f"Brand lookalike detected: {brand.brand_name}")
                elif distance == 2:
                    penalty = add_signal(penalty, reasons, 20, f"Possible brand lookalike detected: {brand.brand_name}")

            for token in root_label_tokens(root_label):
                distance = token_lookalike_distance(token, official_label)
                if distance == 1:
                    penalty = add_signal(penalty, reasons, 30, f"Brand lookalike detected: {brand.brand_name}")
                elif distance == 2:
                    penalty = add_signal(penalty, reasons, 20, f"Possible brand lookalike detected: {brand.brand_name}")

            if official_root_appears_as_subdomain(hostname, official_root) and root_domain != official_root:
                penalty = add_signal(penalty, reasons, 30, f"Misleading brand subdomain detected: {brand.brand_name}")

        if is_punycode and any(keyword.replace("-", "") in hostname.replace("-", "") for keyword in keywords):
            penalty = add_signal(penalty, reasons, 35, f"Punycode brand impersonation detected: {brand.brand_name}")
        elif is_punycode:
            penalty = add_signal(penalty, reasons, 20, "Punycode or IDN domain detected")

        for keyword in keywords:
            if keyword_matches_hostname(keyword, hostname, root_label):
                penalty = add_signal(penalty, reasons, 20, f"Brand keyword used outside official domain: {brand.brand_name}")
                break

        for keyword in keywords:
            if root_label.startswith(f"{keyword}-") or root_label.endswith(f"-{keyword}"):
                penalty = add_signal(penalty, reasons, 20, f"Brand keyword with suspicious suffix or prefix: {brand.brand_name}")
                break

        if any(label in official_roots for label in host_labels[:-2]):
            penalty = add_signal(penalty, reasons, 30, f"Official domain used as misleading subdomain: {brand.brand_name}")

        if penalty > best_penalty:
            best_penalty = penalty
            best_brand = brand.brand_name if has_brand_specific_reason(reasons) else None
            best_reasons = reasons

    return BrandDetection(
        brand_penalty=min(best_penalty, 40),
        matched_brand=best_brand,
        reasons=best_reasons,
    )
