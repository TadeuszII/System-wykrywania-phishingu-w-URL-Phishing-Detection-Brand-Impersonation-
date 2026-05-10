import math
import re
from collections import Counter
from urllib.parse import urlparse

SUSPICIOUS_TLDS = {
    ".xyz",
    ".tk",
    ".ml",
    ".ga",
    ".cf",
    ".gq",
    ".top",
    ".club",
    ".work",
    ".click",
    ".link",
    ".download",
    ".win",
    ".loan",
    ".racing",
    ".party",
    ".stream",
    ".trade",
    ".science",
    ".date",
    ".cc",
    ".pw",
    ".icu",
    ".cyou",
    ".monster",
    ".buzz",
    ".surf",
    ".casa",
    ".rest",
    ".ru",
    ".cn",
    ".xin",
    ".bond",
    ".help",
    ".cfd",
    ".lol",
    ".sbs",
    ".support",
    ".li",
    ".info",
    ".vip",
}

SHORTENERS = {
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "ow.ly",
    "is.gd",
    "buff.ly",
    "adf.ly",
    "short.link",
    "rebrand.ly",
    "tiny.cc",
    "cutt.ly",
    "rb.gy",
    "shorturl.at",
    "bl.ink",
    "snip.ly",
    "clck.ru",
    "qps.ru",
    "u.to",
    "t.ly",
    "qrco.de",
    "goo.su",
    "zzb.bz",
    "x.co",
    "lnkd.in",
    "youtu.be",
    "forms.gle",
    "linktr.ee",
}

SUSPICIOUS_KEYWORDS = [
    "login",
    "verify",
    "account",
    "update",
    "secure",
    "banking",
    "confirm",
    "paypal",
    "ebay",
    "amazon",
    "apple",
    "microsoft",
    "google",
    "signin",
    "password",
    "credential",
    "reset",
    "suspend",
    "validate",
    "urgent",
    "billing",
    "payment",
    "invoice",
    "verification",
    "authenticate",
    "authorization",
    "unlock",
    "reactivate",
    "recover",
    "restore",
    "alert",
    "notice",
    "limited",
    "expire",
    "expir",
    "unusual",
    "suspicious",
    "wallet",
    "crypto",
    "bitcoin",
    "transfer",
    "refund",
    "transaction",
    "checkout",
    "carddetails",
    "cvv",
    "iban",
    "ssn",
    "support",
    "helpdesk",
    "webscr",
    "cmd",
    "redirect",
    "toll",
    "tracking",
    "delivery",
    "parcel",
    "dhl",
    "fedex",
    "usps",
    "ups",
    "netflix",
    "spotify",
    "steam",
    "prize",
    "winner",
    "claim",
    "security",
    "2fa",
    "otp",
    "icloud",
    "dropbox",
    "onedrive",
    "wellsfargo",
    "chase",
    "barclays",
    "hsbc",
    "webmail",
    "cpanel",
    "roundcube",
    "token",
    "session",
    "auth",
]

BRAND_KEYWORDS = [
    "paypal",
    "chase",
    "wellsfargo",
    "barclays",
    "hsbc",
    "citibank",
    "bankofamerica",
    "usbank",
    "capitalone",
    "deutschebank",
    "santander",
    "natwest",
    "lloyds",
    "halifax",
    "ing",
    "bnpparibas",
    "visa",
    "mastercard",
    "americanexpress",
    "amex",
    "google",
    "microsoft",
    "apple",
    "amazon",
    "facebook",
    "meta",
    "instagram",
    "twitter",
    "linkedin",
    "youtube",
    "tiktok",
    "whatsapp",
    "telegram",
    "discord",
    "snapchat",
    "pinterest",
    "reddit",
    "tumblr",
    "twitch",
    "dropbox",
    "icloud",
    "onedrive",
    "googledrive",
    "box",
    "sharepoint",
    "wetransfer",
    "ebay",
    "etsy",
    "shopify",
    "aliexpress",
    "alibaba",
    "wish",
    "walmart",
    "target",
    "bestbuy",
    "ikea",
    "netflix",
    "spotify",
    "hulu",
    "disneyplus",
    "disney",
    "hbomax",
    "paramount",
    "steam",
    "epicgames",
    "playstation",
    "xbox",
    "roblox",
    "outlook",
    "office365",
    "gmail",
    "yahoo",
    "zoho",
    "docusign",
    "adobe",
    "notion",
    "slack",
    "zoom",
    "dhl",
    "fedex",
    "usps",
    "ups",
    "royalmail",
    "dpd",
    "hermes",
    "evri",
    "purolator",
    "coinbase",
    "binance",
    "kraken",
    "metamask",
    "blockchain",
    "robinhood",
    "revolut",
    "cashapp",
    "venmo",
    "zelle",
    "att",
    "verizon",
    "tmobile",
    "sprint",
    "comcast",
    "xfinity",
    "vodafone",
    "orange",
    "o2",
    "bt",
    "irs",
    "gov",
    "hmrc",
    "medicare",
    "socialsecurity",
]

SUSPICIOUS_EXTENSIONS = (
    ".exe",
    ".zip",
    ".rar",
    ".js",
    ".php",
    ".bat",
    ".cmd",
    ".scr",
    ".msi",
    ".apk",
    ".dmg",
    ".ps1",
    ".vbs",
)

VOWELS = set("aeiou")

FEATURE_NAMES = [
    "length_url",
    "length_hostname",
    "nb_hyphens",
    "nb_dots",
    "nb_digits",
    "entropy",
    "full_entropy",
    "nb_at",
    "nb_special_chars",
    "url_digit_ratio",
    "url_symbol_ratio",
    "vowel_ratio",
    "nb_repeated_chars",
    "url_length_suspicious",
    "nb_subdomains",
    "ip",
    "punycode",
    "domain_digit_ratio",
    "long_domain",
    "nb_consecutive_digits",
    "subdomain_is_ip",
    "has_www",
    "suspicious_tld",
    "tld_length",
    "length_path",
    "path_depth",
    "nb_params",
    "query_length",
    "has_suspicious_ext",
    "suspicious_keywords",
    "domain_has_brand",
    "brand_in_path",
    "brand_is_domain",
    "has_hex_encoding",
    "https_in_path",
    "nb_double_slash",
    "nb_redirects",
    "uses_https",
    "shortening_service",
    "has_suspicious_port",
]

FEATURE_NAMES_USED = [name for name in FEATURE_NAMES if name != "uses_https"]


def shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def normalize_url(url: str) -> str:
    value = str(url).strip()
    if value and not value.startswith(("http://", "https://")):
        return f"http://{value}"
    return value


def split_hostname(hostname: str) -> tuple[str, str, str]:
    parts = [part for part in hostname.split(".") if part]
    if len(parts) >= 2:
        domain = parts[-2]
        suffix = parts[-1]
        subdomain = ".".join(parts[:-2])
        return domain, suffix, subdomain
    return hostname, "", ""


def extract_features(url: str) -> list[float]:
    try:
        raw_url = str(url).strip()
        normalized_url = normalize_url(raw_url)
        parsed = urlparse(normalized_url)
        hostname = parsed.hostname or ""
        hostname = hostname.lower()
        domain, suffix_value, subdomain = split_hostname(hostname)
        suffix = f".{suffix_value}" if suffix_value else ""
        path = parsed.path or ""
        query = parsed.query or ""
        full_path = f"{path}?{query}" if query else path

        clean_sub = re.sub(r"^www\.?", "", subdomain)
        nb_subdomains = len(clean_sub.split(".")) if clean_sub else 0

        length_url = len(raw_url)
        length_hostname = len(hostname)
        nb_hyphens = domain.count("-")
        nb_dots = hostname.count(".")
        nb_digits = sum(char.isdigit() for char in domain)
        entropy = round(shannon_entropy(domain), 4)
        full_entropy = round(shannon_entropy(raw_url), 4)
        nb_at = raw_url.count("@")
        nb_special_chars = sum(raw_url.count(char) for char in ["%", "=", "&", "?", "#"])
        url_digit_ratio = round(sum(char.isdigit() for char in raw_url) / max(len(raw_url), 1), 4)
        url_symbol_ratio = round(len(re.findall(r"[^a-zA-Z0-9]", raw_url)) / max(len(raw_url), 1), 4)
        vowel_ratio = round(sum(char in VOWELS for char in domain.lower()) / max(len(domain), 1), 4)
        nb_repeated_chars = len(re.findall(r"(.)\1{2,}", domain))
        url_length_suspicious = 1 if length_url > 100 else 0

        ip = 1 if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", hostname) else 0
        punycode = 1 if "xn--" in raw_url.lower() else 0
        domain_digit_ratio = round(nb_digits / max(len(domain), 1), 3)
        long_domain = 1 if len(domain) > 20 else 0
        nb_consecutive_digits = len(re.findall(r"\d{4,}", hostname))
        subdomain_is_ip = 1 if re.match(r"^\d{1,3}\.\d{1,3}", subdomain) else 0
        has_www = 1 if hostname.startswith("www.") else 0

        suspicious_tld = 1 if suffix.lower() in SUSPICIOUS_TLDS else 0
        tld_length = len(suffix_value) if suffix_value else 0

        length_path = len(path)
        path_depth = path.count("/")
        nb_params = len(re.findall(r"[?&][^=&]+=?[^&]*", raw_url))
        query_length = len(query)
        has_suspicious_ext = 1 if any(path.lower().endswith(ext) for ext in SUSPICIOUS_EXTENSIONS) else 0

        full_path_lower = full_path.lower()
        hostname_lower = hostname.lower()
        suspicious_keywords = sum(1 for keyword in SUSPICIOUS_KEYWORDS if keyword in full_path_lower)
        domain_has_brand = 1 if any(brand in hostname_lower for brand in BRAND_KEYWORDS) else 0
        brand_in_path = 1 if any(brand in full_path_lower for brand in BRAND_KEYWORDS) else 0
        brand_is_domain = 1 if any(brand == domain.lower() for brand in BRAND_KEYWORDS) else 0

        has_hex_encoding = 1 if re.search(r"%[0-9a-fA-F]{2}", raw_url) else 0
        https_in_path = 1 if "https" in path.lower() else 0
        nb_double_slash = max(0, raw_url.count("//") - 1)
        nb_redirects = max(0, len(re.findall(r"https?://", raw_url)) - 1)

        uses_https = 1 if parsed.scheme == "https" else 0
        shortening_service = 1 if hostname_lower in SHORTENERS else 0
        has_suspicious_port = 1 if re.search(r":\d{4,5}/", raw_url) else 0

        return [
            length_url,
            length_hostname,
            nb_hyphens,
            nb_dots,
            nb_digits,
            entropy,
            full_entropy,
            nb_at,
            nb_special_chars,
            url_digit_ratio,
            url_symbol_ratio,
            vowel_ratio,
            nb_repeated_chars,
            url_length_suspicious,
            nb_subdomains,
            ip,
            punycode,
            domain_digit_ratio,
            long_domain,
            nb_consecutive_digits,
            subdomain_is_ip,
            has_www,
            suspicious_tld,
            tld_length,
            length_path,
            path_depth,
            nb_params,
            query_length,
            has_suspicious_ext,
            suspicious_keywords,
            domain_has_brand,
            brand_in_path,
            brand_is_domain,
            has_hex_encoding,
            https_in_path,
            nb_double_slash,
            nb_redirects,
            uses_https,
            shortening_service,
            has_suspicious_port,
        ]
    except Exception:
        return [0] * len(FEATURE_NAMES)


def extract_model_features(url: str) -> list[float]:
    features = dict(zip(FEATURE_NAMES, extract_features(url), strict=False))
    return [features[name] for name in FEATURE_NAMES_USED]
