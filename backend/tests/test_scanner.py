import json
import os
import sys
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.gettempdir()) / f"guardy_test_{os.getpid()}.db"
if TEST_DB.exists():
    TEST_DB.unlink()

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
BRANDS_SEED_PATH = BACKEND_DIR / "seed_data" / "brands.json"

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["ADMIN_API_KEY"] = "test_admin_key"

from fastapi.testclient import TestClient

from app.audit import verify_chain
from app.database import SessionLocal
from app.main import app
from app.scanner.brand_detector import detect_brand_impersonation
from app.scanner.url_analyzer import analyze_url


BRANDS = [
    {
        "brand_name": "PayPal",
        "official_domains": ["paypal.com", "paypal.me"],
        "keywords": ["paypal", "pay-pal"],
    },
    {
        "brand_name": "Microsoft",
        "official_domains": ["microsoft.com", "outlook.com"],
        "keywords": ["microsoft", "outlook"],
    },
]


def load_seed_brands():
    with BRANDS_SEED_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def test_rules_allow_safe_url():
    result = analyze_url("https://www.google.com")
    assert result.rule_score == 0
    assert result.reasons == ["No suspicious patterns detected"]


def test_rules_detect_url_shortener():
    result = analyze_url("https://bit.ly/3xKp9qR")
    assert result.rule_score >= 20
    assert "URL shortener detected" in result.reasons


def test_rules_detect_ip_address():
    result = analyze_url("http://192.168.1.1/login/verify")
    assert result.rule_score >= 25
    assert "IP address used instead of domain" in result.reasons


def test_rules_detect_many_subdomains():
    result = analyze_url("https://a.b.c.d.example.com/login")
    assert result.rule_score >= 15
    assert "Too many subdomains" in result.reasons


def test_rules_detect_punycode():
    result = analyze_url("http://xn--pypal-4va.com/login")
    assert result.rule_score >= 25
    assert "Punycode or IDN domain detected" in result.reasons


def test_brand_detection_ignores_official_domain():
    result = detect_brand_impersonation("https://www.paypal.com/signin", BRANDS)
    assert result.brand_penalty == 0
    assert result.matched_brand is None


def test_brand_detection_finds_lookalike():
    result = detect_brand_impersonation("http://paypa1.com/login", BRANDS)
    assert result.matched_brand == "PayPal"
    assert result.brand_penalty > 0


def test_brand_seed_has_at_least_100_unique_profiles():
    brands = load_seed_brands()
    brand_names = [brand["brand_name"] for brand in brands]

    assert len(brands) >= 100
    assert len(set(brand_names)) == len(brand_names)
    for brand in brands:
        assert brand["brand_name"]
        assert brand["official_domains"]
        assert brand["keywords"]


def test_brand_detection_finds_delivery_brand_from_seed():
    result = detect_brand_impersonation("http://dhl-tracking-update.xyz", load_seed_brands())
    assert result.matched_brand == "DHL"
    assert result.brand_penalty > 0


def test_brand_detection_finds_crypto_brand_from_seed():
    result = detect_brand_impersonation("http://binance-wallet-verify.xyz", load_seed_brands())
    assert result.matched_brand == "Binance"
    assert result.brand_penalty > 0


def test_brand_detection_finds_polish_bank_from_seed():
    result = detect_brand_impersonation("http://mbank-login-secure.xyz", load_seed_brands())
    assert result.matched_brand == "mBank"
    assert result.brand_penalty > 0


def test_brand_detection_finds_misleading_subdomain_from_seed():
    result = detect_brand_impersonation("http://microsoft.com.security-update.example.net", load_seed_brands())
    assert result.matched_brand == "Microsoft"
    assert result.brand_penalty > 0


def test_brand_detection_finds_lithuanian_bank_from_seed():
    result = detect_brand_impersonation("http://swedbank-login-secure.xyz", load_seed_brands())
    assert result.matched_brand == "Swedbank Lithuania"
    assert result.brand_penalty > 0


def test_brand_detection_finds_lithuanian_fintech_from_seed():
    result = detect_brand_impersonation("http://paysera-account-verify.xyz", load_seed_brands())
    assert result.matched_brand == "Paysera"
    assert result.brand_penalty > 0


def test_brand_detection_finds_lithuanian_telco_from_seed():
    result = detect_brand_impersonation("http://telia-bill-update.xyz", load_seed_brands())
    assert result.matched_brand == "Telia Lithuania"
    assert result.brand_penalty > 0


def test_brand_detection_finds_lithuanian_marketplace_from_seed():
    result = detect_brand_impersonation("http://skelbiu-payment-confirm.xyz", load_seed_brands())
    assert result.matched_brand == "Skelbiu.lt"
    assert result.brand_penalty > 0


def test_brand_detection_ignores_lithuanian_official_bank_domain():
    result = detect_brand_impersonation("https://www.seb.lt/", load_seed_brands())
    assert result.brand_penalty == 0
    assert result.matched_brand is None


def test_scan_url_warns_on_invalid_url():
    with TestClient(app) as client:
        response = client.post("/scan/url", json={"url": "not a url"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["decision"] == "WARN"
    assert "Invalid URL format" in payload["reasons"]


def test_scan_url_blocks_phishing_url():
    with TestClient(app) as client:
        response = client.post("/scan/url", json={"url": "http://paypal-secure-login.xyz/verify"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["decision"] == "BLOCK"
    assert payload["risk_score"] >= 70
    assert payload["matched_brand"] == "PayPal"


def test_admin_brands_requires_api_key():
    with TestClient(app) as client:
        response = client.post(
            "/brands",
            json={
                "brand_name": "Test Brand",
                "official_domains": ["testbrand.example"],
                "keywords": ["testbrand"],
            },
        )
    assert response.status_code == 403


def test_admin_can_list_audit_logs_and_chain_is_valid():
    with TestClient(app) as client:
        client.post("/scan/url", json={"url": "https://www.google.com"})
        response = client.get("/audit/logs", headers={"X-API-Key": "test_admin_key"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert payload["items"][0]["request_hash"]
    assert payload["items"][0]["chain_hash"]

    with SessionLocal() as db:
        assert verify_chain(db) is True


def test_audit_logs_are_not_editable_by_api():
    with TestClient(app) as client:
        response = client.delete("/audit/logs", headers={"X-API-Key": "test_admin_key"})
    assert response.status_code == 405
