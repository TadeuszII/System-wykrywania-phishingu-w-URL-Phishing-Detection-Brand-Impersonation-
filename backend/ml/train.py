import pandas as pd
import numpy as np
import re
import math
import json
import joblib
import warnings
import matplotlib.pyplot as plt
import seaborn as sns
from urllib.parse import urlparse
from collections import Counter
from tqdm import tqdm
import tldextract
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.metrics import (
    classification_report, confusion_matrix,
    roc_auc_score, roc_curve, accuracy_score
)
from sklearn.utils import resample
warnings.filterwarnings('ignore')
print('Imports OK.')

# ==============================================================================
## Step 3 — Feature Extraction 
# ==============================================================================


import math
import re
from collections import Counter
from urllib.parse import urlparse
import tldextract


# ==============================================================================
# CONSTANTS
# ==============================================================================

SUSPICIOUS_TLDS = {
    '.xyz','.tk','.ml','.ga','.cf','.gq','.top','.club',
    '.work','.click','.link','.download','.win','.loan',
    '.racing','.party','.stream','.trade','.science','.date',
    '.cc','.pw','.icu','.cyou','.monster','.buzz','.surf',
    '.casa','.rest','.ru','.cn',
    '.xin','.bond','.help','.cfd','.lol','.sbs','.support',
    '.li','.info','.vip',
}

SHORTENERS = {
    'bit.ly','tinyurl.com','t.co','goo.gl','ow.ly',
    'is.gd','buff.ly','adf.ly','short.link','rebrand.ly',
    'tiny.cc','cutt.ly','rb.gy','shorturl.at',
    'bl.ink','snip.ly','clck.ru','qps.ru','u.to',
    't.ly','qrco.de','goo.su','zzb.bz','x.co',
    'lnkd.in','youtu.be','forms.gle','linktr.ee',
}

SUSPICIOUS_KEYWORDS = [
    'login','verify','account','update','secure','banking',
    'confirm','paypal','ebay','amazon','apple','microsoft',
    'google','signin','password','credential','reset','suspend',
    'validate','urgent','billing','payment','invoice',
    'verification','authenticate','authorization','unlock',
    'reactivate','recover','restore','alert','notice',
    'limited','expire','expir','unusual','suspicious',
    'wallet','crypto','bitcoin','transfer','refund',
    'transaction','checkout','carddetails','cvv','iban',
    'ssn','support','helpdesk','webscr','cmd','redirect',
    'toll','tracking','delivery','parcel',
    'dhl','fedex','usps','ups',
    'netflix','spotify','steam',
    'prize','winner','claim',
    'security','2fa','otp',
    'icloud','dropbox','onedrive',
    'wellsfargo','chase','barclays','hsbc',
    'webmail','cpanel','roundcube',
    'token','session','auth',
]

BRAND_KEYWORDS = [
    # Finance & Banking
    'paypal','chase','wellsfargo','barclays','hsbc','citibank',
    'bankofamerica','usbank','capitalone','deutschebank',
    'santander','natwest','lloyds','halifax','ing','bnpparibas',
    'visa','mastercard','americanexpress','amex',
    # Big Tech
    'google','microsoft','apple','amazon','facebook','meta',
    'instagram','twitter','linkedin','youtube','tiktok',
    'whatsapp','telegram','discord','snapchat','pinterest',
    'reddit','tumblr','twitch',
    # Cloud & Storage
    'dropbox','icloud','onedrive','googledrive','box',
    'sharepoint','wetransfer',
    # E-commerce & Retail
    'ebay','etsy','shopify','aliexpress','alibaba','wish',
    'walmart','target','bestbuy','ikea',
    # Streaming & Subscriptions
    'netflix','spotify','hulu','disneyplus','disney',
    'hbomax','paramount','steam','epicgames','playstation',
    'xbox','roblox',
    # Email & Productivity
    'outlook','office365','gmail','yahoo','zoho',
    'docusign','adobe','notion','slack','zoom',
    # Delivery & Logistics
    'dhl','fedex','usps','ups','royalmail','dpd',
    'hermes','evri','purolator',
    # Crypto & Fintech
    'coinbase','binance','kraken','metamask','blockchain',
    'robinhood','revolut','cashapp','venmo','zelle',
    # Telecom & ISP
    'att','verizon','tmobile','sprint','comcast','xfinity',
    'vodafone','orange','o2','bt',
    # Government & Auth
    'irs','gov','hmrc','medicare','socialsecurity',
]

SUSPICIOUS_EXTENSIONS = (
    '.exe','.zip','.rar','.js','.php','.bat','.cmd','.scr',
    '.msi','.apk','.dmg','.ps1','.vbs',
)

VOWELS = set('aeiou')


# ==============================================================================
# HELPERS
# ==============================================================================

def shannon_entropy(s):
    if not s:
        return 0.0
    counts = Counter(s)
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in counts.values())


# ==============================================================================
# FEATURE EXTRACTION
# ==============================================================================

def extract_features(url):
    try:
        url = str(url).strip()
        parsed = urlparse(url if url.startswith('http') else 'http://' + url)
        ext        = tldextract.extract(url)
        domain     = ext.domain or ''
        suffix     = '.' + ext.suffix if ext.suffix else ''
        subdomain  = ext.subdomain or ''
        hostname   = parsed.hostname or ''
        path       = parsed.path or ''
        query      = parsed.query or ''
        full_path  = path + '?' + query if query else path

        clean_sub     = re.sub(r'^www\.?', '', subdomain)
        nb_subdomains = len(clean_sub.split('.')) if clean_sub else 0

        # ---- Lexical ----------------------------------------------------------------------------─
        length_url            = len(url)
        length_hostname       = len(hostname)
        nb_hyphens            = domain.count('-')
        nb_dots               = hostname.count('.')
        nb_digits             = sum(c.isdigit() for c in domain)
        entropy               = round(shannon_entropy(domain), 4)
        full_entropy          = round(shannon_entropy(url), 4)
        nb_at                 = url.count('@')
        nb_special_chars      = sum(url.count(c) for c in ['%', '=', '&', '?', '#'])
        url_digit_ratio       = round(sum(c.isdigit() for c in url) / max(len(url), 1), 4)
        url_symbol_ratio      = round(len(re.findall(r'[^a-zA-Z0-9]', url)) / max(len(url), 1), 4)
        vowel_ratio           = round(sum(c in VOWELS for c in domain.lower()) / max(len(domain), 1), 4)
        nb_repeated_chars     = len(re.findall(r'(.)\1{2,}', domain))
        url_length_suspicious = 1 if length_url > 100 else 0

        # ---- Domain ----
        ip                    = 1 if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', hostname) else 0
        punycode              = 1 if 'xn--' in url.lower() else 0
        domain_digit_ratio    = round(nb_digits / max(len(domain), 1), 3)
        long_domain           = 1 if len(domain) > 20 else 0
        nb_consecutive_digits = len(re.findall(r'\d{4,}', hostname))
        subdomain_is_ip       = 1 if re.match(r'^\d{1,3}\.\d{1,3}', subdomain) else 0
        has_www               = 1 if hostname.startswith('www.') else 0

        # ---- TLD --------
        suspicious_tld        = 1 if suffix.lower() in SUSPICIOUS_TLDS else 0
        tld_length            = len(ext.suffix) if ext.suffix else 0

        # ---- Path & Query ------------------------------------------------------------------------
        length_path           = len(path)
        path_depth            = path.count('/')
        nb_params             = len(re.findall(r'[?&][^=&]+=?[^&]*', url))
        query_length          = len(query)
        has_suspicious_ext    = 1 if any(path.lower().endswith(e) for e in SUSPICIOUS_EXTENSIONS) else 0

        # ---- Keywords & Brands ----------------------------------------------------------------
        suspicious_keywords   = sum(1 for kw in SUSPICIOUS_KEYWORDS if kw in full_path.lower())
        domain_has_brand      = 1 if any(b in hostname.lower() for b in BRAND_KEYWORDS) else 0
        brand_in_path         = 1 if any(b in full_path.lower() for b in BRAND_KEYWORDS) else 0
        brand_is_domain       = 1 if any(b == domain.lower() for b in BRAND_KEYWORDS) else 0  # ✅ NEW

        # ---- Obfuscation ------------------------------------------------------------------------
        has_hex_encoding      = 1 if re.search(r'%[0-9a-fA-F]{2}', url) else 0
        https_in_path         = 1 if 'https' in path.lower() else 0
        nb_double_slash       = max(0, url.count('//') - 1)
        nb_redirects          = max(0, len(re.findall(r'https?://', url)) - 1)

        # ---- Protocol & Services ------------------------------------------------------------─
        uses_https            = 1 if parsed.scheme == 'https' else 0
        shortening_service    = 1 if hostname.lower() in SHORTENERS else 0
        has_suspicious_port   = 1 if re.search(r':\d{4,5}/', url) else 0

        return [
            # Lexical (15)
            length_url, length_hostname, nb_hyphens, nb_dots,
            nb_digits, entropy, full_entropy, nb_at, nb_special_chars,
            url_digit_ratio, url_symbol_ratio, vowel_ratio,
            nb_repeated_chars, url_length_suspicious, nb_subdomains,
            # Domain (7)
            ip, punycode, domain_digit_ratio, long_domain,
            nb_consecutive_digits, subdomain_is_ip, has_www,
            # TLD (2)
            suspicious_tld, tld_length,
            # Path & Query (5)
            length_path, path_depth, nb_params, query_length, has_suspicious_ext,
            # Keywords & Brands (4)  ← was 3, now 4
            suspicious_keywords, domain_has_brand, brand_in_path, brand_is_domain,
            # Obfuscation (4)
            has_hex_encoding, https_in_path, nb_double_slash, nb_redirects,
            # Protocol & Services (3)
            uses_https, shortening_service, has_suspicious_port,
        ]
    except Exception:
        return [0] * 40


FEATURE_NAMES = [
    # Lexical (15)
    'length_url', 'length_hostname', 'nb_hyphens', 'nb_dots',
    'nb_digits', 'entropy', 'full_entropy', 'nb_at', 'nb_special_chars',
    'url_digit_ratio', 'url_symbol_ratio', 'vowel_ratio',
    'nb_repeated_chars', 'url_length_suspicious', 'nb_subdomains',
    # Domain (7)
    'ip', 'punycode', 'domain_digit_ratio', 'long_domain',
    'nb_consecutive_digits', 'subdomain_is_ip', 'has_www',
    # TLD (2)
    'suspicious_tld', 'tld_length',
    # Path & Query (5)
    'length_path', 'path_depth', 'nb_params', 'query_length', 'has_suspicious_ext',
    # Keywords & Brands (4)
    'suspicious_keywords', 'domain_has_brand', 'brand_in_path', 'brand_is_domain',
    # Obfuscation (4)
    'has_hex_encoding', 'https_in_path', 'nb_double_slash', 'nb_redirects',
    # Protocol & Services (3)
    'uses_https', 'shortening_service', 'has_suspicious_port',
]


# ==============================================================================
# SANITY CHECK
# ==============================================================================

if __name__ == '__main__':
    test_urls = [
        'http://paypal-secure-login.xyz/verify?user=1',
        'https://www.google.com/search?q=hello',
        'http://192.168.1.1/admin/login.php',
        'https://bit.ly/3xK9mZp',
        'http://xn--pple-43d.com/account/reset',
    ]
    for u in test_urls:
        result = extract_features(u)
        assert len(result) == 40, f'Expected 40, got {len(result)}'
        print(f'\nURL: {u}')
        print(dict(zip(FEATURE_NAMES, result)))
    print(f'\nAll checks passed — Feature count: {len(FEATURE_NAMES)}')

# ==============================================================================
# Step 4 — Load Dataset
# ==============================================================================


# ============================================================
# STEP 4 — Load & Normalize Dataset
# ============================================================

df = pd.read_csv('phishing_site_urls.csv')
print('Shape:', df.shape)
print('Columns:', df.columns.tolist())
print('Raw labels:', df.iloc[:, -1].value_counts().to_dict())

# Rename columns to standard names
df = df.rename(columns={df.columns[0]: 'url', df.columns[-1]: 'raw_label'})
df = df[['url', 'raw_label']].dropna()

# Remove broken/empty URLs
df = df[df['url'].str.strip().str.len() > 5]

# Remove duplicates — prevents train/test data leakage
df = df.drop_duplicates(subset=['url'])

# Map all known label variants → 0 (legit) / 1 (phishing)
df['label'] = df['raw_label'].map({
    'good': 0,       'bad': 1,
    'legitimate': 0, 'phishing': 1,
    '0': 0,          '1': 1,
    0: 0,            1: 1,
})
df = df.dropna(subset=['label'])
df['label'] = df['label'].astype(int)

# Shuffle
df = df.sample(frac=1, random_state=42).reset_index(drop=True)

print(f'\nAfter normalization: {len(df)} rows')
print(f'Phishing:   {df["label"].sum()} ({df["label"].mean()*100:.1f}%)')
print(f'Legitimate: {len(df)-df["label"].sum()} ({(1-df["label"].mean())*100:.1f}%)')


# ============================================================
# STEP 5 — Feature Extraction
# ============================================================

tqdm.pandas(desc='Extracting features')
features_list = df['url'].progress_apply(extract_features).tolist()

X = pd.DataFrame(features_list, columns=FEATURE_NAMES)
y = df['label'].values

assert X.shape[1] == len(FEATURE_NAMES), \
    f"Feature mismatch: got {X.shape[1]}, expected {len(FEATURE_NAMES)}"

# Remove failed extractions
mask = (X == 0).all(axis=1)
if mask.sum() > 0:
    print(f'Removing {mask.sum()} failed rows...')
    X = X[~mask].reset_index(drop=True)
    y = y[~mask]
    print(f'Removed. Remaining: {len(X)} rows')
else:
    print('No failed extractions')

# Drop zero-signal feature
X = X.drop(columns=['uses_https'])
FEATURE_NAMES_USED = [f for f in FEATURE_NAMES if f != 'uses_https']
print(f'Features after cleanup: {len(FEATURE_NAMES_USED)}')  # → 39

X_save = X.copy()
X_save['label'] = y
X_save.to_csv('features_extracted.csv', index=False)

print(f'\nDone. Shape: {X.shape}')
print(X.describe().round(3))

# ============================================================
# STEP 6 — Balance + Split + Train
# ============================================================

# 1. Split FIRST
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
print(f'Train: {len(X_train)} | Test: {len(X_test)}')

# 2. Balance ONLY the training set
train_df = X_train.copy()
train_df['label'] = y_train

train_legit = train_df[train_df['label'] == 0]
train_phish = train_df[train_df['label'] == 1]

if len(train_phish) < len(train_legit):
    train_phish = resample(train_phish, replace=True,
                           n_samples=len(train_legit), random_state=42)
else:
    train_legit = resample(train_legit, replace=True,
                           n_samples=len(train_phish), random_state=42)

train_balanced = pd.concat([train_legit, train_phish])
train_balanced = train_balanced.sample(frac=1, random_state=42).reset_index(drop=True)

X_train_bal = train_balanced.drop('label', axis=1)
y_train_bal  = train_balanced['label']

print(f'\nBalanced training set: {len(X_train_bal)} rows')
print(f'  Phishing:   {y_train_bal.sum()} (50.0%)')
print(f'  Legitimate: {len(y_train_bal)-y_train_bal.sum()} (50.0%)')
print(f'\nTest set (untouched): {len(X_test)} rows')
print(f'  Phishing:   {y_test.sum()} ({y_test.mean()*100:.1f}%)')
print(f'  Legitimate: {len(y_test)-y_test.sum()} ({(1-y_test.mean())*100:.1f}%)')

# 3. Train XGBoost
model = XGBClassifier(
    n_estimators=300,
    max_depth=8,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=5,
    gamma=0.1,
    random_state=42,
    eval_metric='auc',
    n_jobs=-1
)

model.fit(
    X_train_bal, y_train_bal,
    eval_set=[(X_test, y_test)],
    verbose=50
)
print('\nTraining complete.')


y_pred = model.predict(X_test)
y_prob = model.predict_proba(X_test)[:,1]

print('='*50)
print('CLASSIFICATION REPORT')
print('='*50)
print(classification_report(y_test, y_pred, target_names=['Legitimate','Phishing']))
print(f'ROC-AUC Score: {roc_auc_score(y_test, y_prob):.4f}')
print(f'Accuracy:      {accuracy_score(y_test, y_pred):.4f}')

# ============================================================
# STEP 8 — 5-Fold Cross Validation
# ============================================================

print('Running 5-fold cross-validation...')
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
cv_scores = cross_val_score(model, X_train_bal, y_train_bal, cv=cv, scoring='accuracy', n_jobs=-1)
print(f'CV Accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})')
print(f'Scores per fold: {[round(s,4) for s in cv_scores]}')

# Confusion Matrix + ROC Curve
fig, axes = plt.subplots(1, 2, figsize=(14,5))

cm = confusion_matrix(y_test, y_pred)
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', ax=axes[0],
            xticklabels=['Legitimate','Phishing'],
            yticklabels=['Legitimate','Phishing'])
axes[0].set_title('Confusion Matrix')
axes[0].set_xlabel('Predicted')
axes[0].set_ylabel('Actual')

fpr, tpr, _ = roc_curve(y_test, y_prob)
auc = roc_auc_score(y_test, y_prob)
axes[1].plot(fpr, tpr, color='#0071E3', lw=2, label=f'ROC AUC = {auc:.4f}')
axes[1].plot([0,1],[0,1],'k--',lw=1)
axes[1].set_xlabel('False Positive Rate')
axes[1].set_ylabel('True Positive Rate')
axes[1].set_title('ROC Curve')
axes[1].legend(loc='lower right')
plt.tight_layout()
plt.savefig('evaluation.png', dpi=150, bbox_inches='tight')
plt.show()
print('Saved: evaluation.png')

# ============================================================
# FEATURE IMPORTANCE
# ============================================================

importances = model.feature_importances_
feat_imp = pd.DataFrame({
    'feature': FEATURE_NAMES_USED,
    'importance': importances
})

feat_imp = feat_imp.sort_values('importance', ascending=True)

plt.figure(figsize=(10, 8))
plt.barh(feat_imp['feature'], feat_imp['importance'], color='#0071E3')
plt.xlabel('Importance Score')
plt.title('Feature Importance — Guardy Phishing Detection Model')
plt.tight_layout()
plt.savefig('feature_importance.png', dpi=150, bbox_inches='tight')
plt.show()

print('Top 5 most important features:')
print(feat_imp.tail(5)[['feature', 'importance']].to_string(index=False))

# ============================================================
# REAL WORLD URL TESTS
# ============================================================

def test_url(url, expected_label, description):
    features = extract_features(url)

    # Wrap in DataFrame, drop uses_https to match 38 trained features
    features_df = pd.DataFrame([features], columns=FEATURE_NAMES)
    features_df = features_df[FEATURE_NAMES_USED]

    score = model.predict_proba(features_df)[0][1]
    pred = 'PHISHING' if score >= 0.5 else 'LEGITIMATE'
    expected_str = 'PHISHING' if expected_label == 1 else 'LEGITIMATE'
    status = 'PASS' if pred == expected_str else 'FAIL'
    icon = '✅' if status == 'PASS' else '❌'
    print(f'{icon} [{status}] {description}')
    print(f'        Score: {score:.3f} | Predicted: {pred} | Expected: {expected_str}')
    print(f'        URL: {url[:80]}')
    print()
    return status == 'PASS'


print('=' * 60)
print('REAL WORLD URL TESTS')
print('=' * 60)
print()

tests = [
    # Safe URLs
    ('https://www.google.com', 0, 'Google — safe'),
    ('https://www.paypal.com/login', 0, 'PayPal official — safe'),
    ('https://github.com/user/repo', 0, 'GitHub — safe'),
    ('https://accounts.google.com/signin', 0, 'Google accounts — safe'),
    ('https://www.microsoft.com/en-us', 0, 'Microsoft official — safe'),
    ('https://mail.google.com/mail/u/0/', 0, 'Gmail — multiple subdomains safe'),
    ('https://secure.bankofamerica.com/login', 0, 'Real bank — login in path'),
    # Phishing URLs
    ('http://192.168.1.1/login/verify', 1, 'IP address — phishing'),
    ('http://bit.ly/3xKp9qR', 1, 'URL shortener — phishing'),
    ('http://paypal-secure-login.xyz/verify?account=1', 1, 'PayPal lookalike + .xyz'),
    ('http://xn--pypal-4va.com/login', 1, 'IDN punycode PayPal homograph'),
    ('http://secure-account-update-login.tk/verify', 1, 'Keywords + .tk TLD'),
    ('http://apple-id-verify.gq/reset-password', 1, 'Apple lookalike + .gq'),
    ('http://micros0ft-update.ml/windows/update', 1, 'Microsoft lookalike + .ml'),
    ('http://paypal.com.login-verify.example.net', 1, 'PayPal as misleading subdomain'),
]

results = [test_url(url, label, desc) for url, label, desc in tests]
passed = sum(results)
total = len(results)
print('=' * 60)
print(f'RESULT: {passed}/{total} tests passed ({passed/total*100:.0f}%)')
print('=' * 60)

# ============================================================
# REAL WORLD URL TESTS — Extended (25 URLs)
# ============================================================

def test_url(url, expected_label, description):
    features = extract_features(url)
    features_df = pd.DataFrame([features], columns=FEATURE_NAMES)
    features_df = features_df[FEATURE_NAMES_USED]

    score = model.predict_proba(features_df)[0][1]
    pred = 'PHISHING' if score >= 0.5 else 'LEGITIMATE'
    expected_str = 'PHISHING' if expected_label == 1 else 'LEGITIMATE'
    status = 'PASS' if pred == expected_str else 'FAIL'
    icon = '👍' if status == 'PASS' else '👎'
    print(f'{icon} [{status}] {description}')
    print(f'        Score: {score:.3f} | Predicted: {pred} | Expected: {expected_str}')
    print(f'        URL: {url[:80]}')
    print()
    return status == 'PASS'


print('=' * 60)
print('REAL WORLD URL TESTS — Extended (25 URLs)')
print('=' * 60)
print()

tests = [
    # ---- Legitimate URLs ----------------------------------------------------
    ('https://www.google.com/search?q=python', 0, 'Google search — legit'),
    ('https://www.paypal.com/login', 0, 'PayPal official — legit'),
    ('https://github.com/user/repo', 0, 'GitHub — legit'),
    ('https://accounts.google.com/signin', 0, 'Google accounts — legit'),
    ('https://www.microsoft.com/en-us', 0, 'Microsoft official — legit'),
    ('https://mail.google.com/mail/u/0/', 0, 'Gmail — legit'),
    ('https://secure.bankofamerica.com/login', 0, 'Bank of America — legit'),
    ('https://www.amazon.com/dp/B08N5WRWNW', 0, 'Amazon product — legit'),
    ('https://www.netflix.com/browse', 0, 'Netflix browse — legit'),
    ('https://stackoverflow.com/questions/tagged/python', 0, 'StackOverflow — legit'),
    ('https://www.linkedin.com/in/username', 0, 'LinkedIn profile — legit'),
    ('https://en.wikipedia.org/wiki/Phishing', 0, 'Wikipedia — legit'),

    # ---- Phishing URLs ----------------------------------------------------─
    ('http://192.168.1.1/login/verify', 1, 'IP address — phishing'),
    ('http://bit.ly/3xKp9qR', 1, 'URL shortener — phishing'),
    ('http://paypal-secure-login.xyz/verify?account=1', 1, 'PayPal lookalike + .xyz'),
    ('http://xn--pypal-4va.com/login', 1, 'Punycode PayPal homograph'),
    ('http://secure-account-update-login.tk/verify', 1, 'Keywords + .tk TLD'),
    ('http://apple-id-verify.gq/reset-password', 1, 'Apple lookalike + .gq'),
    ('http://micros0ft-update.ml/windows/update', 1, 'Microsoft typo + .ml'),
    ('http://paypal.com.login-verify.example.net', 1, 'Brand as subdomain'),
    ('http://amazon-security-alert.cf/account/suspend', 1, 'Amazon alert + .cf'),
    ('http://netflix-billing-update.top/payment', 1, 'Netflix billing + .top'),
    ('http://chase-bank-verify.pw/signin?user=1', 1, 'Chase bank + .pw'),
    ('http://support-microsoft-helpdesk.xyz/credentials', 1, 'MS support scam + .xyz'),
    ('http://secure123456.icu/verify/account/reset', 1, 'Digits + .icu + keywords'),
]

results = [test_url(url, label, desc) for url, label, desc in tests]
passed = sum(results)
total = len(results)
print('=' * 60)
print(f'RESULT: {passed}/{total} tests passed ({passed/total*100:.0f}%)')
print('=' * 60)
