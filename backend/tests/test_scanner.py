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

from app.audit import resolve_source, verify_chain
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


def test_rules_detect_qr_shortener():
    result = analyze_url("https://q-r.to/bgbfmu")
    assert result.rule_score >= 30
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


def test_rules_detect_free_hosting_platform_as_soft_signal():
    result = analyze_url("https://project.vercel.app")
    assert result.rule_score == 10
    assert "Commonly abused free hosting platform detected" in result.reasons


def test_rules_combine_free_hosting_with_suspicious_keywords():
    result = analyze_url("https://paypal-login.pages.dev/verify")
    assert result.rule_score > 10
    assert "Commonly abused free hosting platform detected" in result.reasons
    assert "Suspicious keyword detected: login" in result.reasons


def test_rules_detect_suspicious_free_hosting_support_page():
    result = analyze_url("https://goes326-goutian-bc.pages.dev/help/contact/206000278552756")
    assert result.rule_score >= 70
    assert "Commonly abused free hosting platform detected" in result.reasons
    assert "Suspicious free-hosting subdomain detected" in result.reasons
    assert "Support-themed path on free hosting platform" in result.reasons
    assert "Long numeric path token detected" in result.reasons


def test_rules_do_not_penalize_normal_contact_path():
    result = analyze_url("https://example.com/contact")
    assert result.rule_score == 0
    assert result.reasons == ["No suspicious patterns detected"]


def test_rules_detect_long_numeric_path_token_globally():
    result = analyze_url("https://example.com/ticket/206000278552756")
    assert result.rule_score == 10
    assert "Long numeric path token detected" in result.reasons


def test_rules_ignore_entropy_for_normal_known_domains():
    stackoverflow_result = analyze_url("https://stackoverflow.com/users/login")
    cloudflare_result = analyze_url("https://dash.cloudflare.com/login")

    assert "High domain entropy" not in stackoverflow_result.reasons
    assert "High domain entropy" not in cloudflare_result.reasons


def test_rules_detect_non_standard_port():
    result = analyze_url("http://paypal.com:8080/login")
    assert result.rule_score >= 45
    assert "Suspicious non-standard port detected" in result.reasons


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


def test_brand_detection_ignores_any_official_domain_before_lookalike_checks():
    brands = load_seed_brands()

    github_result = detect_brand_impersonation("https://github.com", brands)
    gitlab_result = detect_brand_impersonation("https://gitlab.com", brands)

    assert github_result.brand_penalty == 0
    assert github_result.matched_brand is None
    assert gitlab_result.brand_penalty == 0
    assert gitlab_result.matched_brand is None


def test_brand_detection_still_detects_github_and_gitlab_impersonation():
    brands = load_seed_brands()

    github_result = detect_brand_impersonation("http://github-login.xyz", brands)
    gitlab_result = detect_brand_impersonation("http://gitlab-security.xyz", brands)

    assert github_result.matched_brand == "GitHub"
    assert github_result.brand_penalty > 0
    assert gitlab_result.matched_brand == "GitLab"
    assert gitlab_result.brand_penalty > 0


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


def test_scan_url_allows_official_auth_paths():
    with TestClient(app) as client:
        instagram_response = client.post(
            "/scan/url",
            json={"url": "https://www.instagram.com/accounts/login/"},
        )
        github_response = client.post(
            "/scan/url",
            json={"url": "https://github.com/login"},
        )
        bank_response = client.post(
            "/scan/url",
            json={"url": "https://secure.bankofamerica.com/login/sign-in/signOnV2Screen.go"},
        )

    instagram_payload = instagram_response.json()
    github_payload = github_response.json()
    bank_payload = bank_response.json()

    assert instagram_response.status_code == 200
    assert instagram_payload["decision"] == "ALLOW"
    assert instagram_payload["risk_score"] <= 25
    assert github_response.status_code == 200
    assert github_payload["decision"] == "ALLOW"
    assert github_payload["risk_score"] <= 25
    assert bank_response.status_code == 200
    assert bank_payload["decision"] == "ALLOW"
    assert bank_payload["risk_score"] <= 25


def test_scan_url_does_not_cap_impersonation_or_misleading_domains():
    with TestClient(app) as client:
        impersonation_response = client.post(
            "/scan/url",
            json={"url": "http://instagram-help-center-login.xyz"},
        )
        misleading_response = client.post(
            "/scan/url",
            json={"url": "https://instagram.com.evil.xyz/accounts/login"},
        )

    assert impersonation_response.status_code == 200
    assert impersonation_response.json()["decision"] == "BLOCK"
    assert misleading_response.status_code == 200
    assert misleading_response.json()["decision"] != "ALLOW"


def test_scan_url_does_not_cap_non_standard_port_on_official_domain():
    with TestClient(app) as client:
        response = client.post(
            "/scan/url",
            json={"url": "http://paypal.com:8080/login"},
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["decision"] != "ALLOW"
    assert "Suspicious non-standard port detected" in payload["reasons"]


def test_scan_url_keeps_secure_brand_impersonation_blocked():
    with TestClient(app) as client:
        response = client.post(
            "/scan/url",
            json={"url": "http://secure-bankofamerica-login.xyz"},
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["decision"] == "BLOCK"
    assert payload["matched_brand"] == "Bank of America"


def test_scan_url_keeps_free_hosting_and_typo_phishing_risky():
    with TestClient(app) as client:
        hosting_response = client.post(
            "/scan/url",
            json={"url": "https://goes326-goutian-bc.pages.dev/help/contact/206000278552756"},
        )
        typo_response = client.post(
            "/scan/url",
            json={"url": "http://g00gle.com/account/verify"},
        )

    assert hosting_response.status_code == 200
    assert hosting_response.json()["decision"] == "BLOCK"
    assert typo_response.status_code == 200
    assert typo_response.json()["decision"] != "ALLOW"


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


def test_audit_source_mapping():
    assert resolve_source("clicked_link") == "chrome_extension/clicked_link"
    assert resolve_source("manual_popup") == "chrome_extension/manual_popup"
    assert resolve_source("test_suite") == "test_suite"
    assert resolve_source("seed") == "seed"
    assert resolve_source("batch_scan") == "batch_scan"
    assert resolve_source(None) == "api_direct"
    assert resolve_source("unknown_context") == "api_direct"


def test_scan_url_records_clicked_link_source():
    with TestClient(app) as client:
        client.post(
            "/scan/url",
            json={"url": "https://www.google.com", "context": "clicked_link"},
        )
        response = client.get("/audit/logs", headers={"X-API-Key": "test_admin_key"})

    assert response.status_code == 200
    assert response.json()["items"][0]["source"] == "chrome_extension/clicked_link"


def test_scan_url_records_api_direct_source_without_context():
    with TestClient(app) as client:
        client.post("/scan/url", json={"url": "https://www.google.com"})
        response = client.get("/audit/logs", headers={"X-API-Key": "test_admin_key"})

    assert response.status_code == 200
    assert response.json()["items"][0]["source"] == "api_direct"
