# Guardy - system wykrywania phishingu w URL

Guardy to system do analizy adresow URL pod katem phishingu i podszywania sie pod znane marki. Projekt sklada sie z backendu FastAPI oraz rozszerzenia Chrome dzialajacego lokalnie w przegladarce. Rozszerzenie przechwytuje klikniecia w linki, wysyla URL do backendu i pokazuje decyzje `ALLOW`, `WARN` albo `BLOCK` razem z wynikiem ryzyka i powodami klasyfikacji.

System laczy kilka warstw detekcji:

- analiza regulowa URL, m.in. podejrzane TLD, skrocone linki, punycode, adresy IP, porty, slowa kluczowe, dlugie sciezki i nietypowe subdomeny;
- wykrywanie brand impersonation na podstawie profili marek, oficjalnych domen, slow kluczowych, podobienstwa nazw i mylacych subdomen;
- opcjonalny model ML wczytywany z `backend/ml/model.pkl`; gdy model nie istnieje, backend uzywa bezpiecznego fallbacku;
- zapis wynikow skanowania w SQLite;
- audytowy lancuch hashy dla logow skanowania;
- opcjonalne porownanie z VirusTotal przez endpoint backendu.

## Technologie

### Backend

- Python 3.11
- FastAPI
- Uvicorn
- SQLAlchemy
- SQLite
- Pydantic
- pytest
- pandas, scikit-learn, xgboost dla czesci ML

### Frontend

- Chrome Extension Manifest V3
- JavaScript ES Modules
- HTML i CSS bez bundlera
- `chrome.storage.local` do ustawien i historii
- Service Worker jako warstwa komunikacji z backendem

## Wymagania

- Python 3.11 lub nowszy
- Docker i Docker Compose, jezeli uruchamiasz projekt kontenerowo
- Google Chrome albo inna przegladarka zgodna z rozszerzeniami Chromium MV3
- opcjonalnie klucz VirusTotal API do porownywania wynikow

## Uruchomienie przez Docker

Najprostszy sposob uruchomienia backendu:

```powershell
docker compose up --build
```

Backend bedzie dostepny pod adresem:

```text
http://localhost:8000
```

Domyslny klucz administratora dla endpointow chronionych to:

```text
admin_api_key
```

Mozna go zmienic przez zmienna srodowiskowa:

```powershell
$env:ADMIN_API_KEY="twoj_klucz"
docker compose up --build
```

W Dockerze baza SQLite jest zapisywana w wolumenie `guardy-data`.

## Uruchomienie backendu lokalnie

Przejdz do katalogu backendu:

```powershell
cd backend
```

Utworz i aktywuj wirtualne srodowisko:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Zainstaluj zaleznosci:

```powershell
python -m pip install -r requirements.txt
```

Uruchom API:

```powershell
python -m uvicorn app.main:app --reload
```

Backend bedzie dostepny pod adresem:

```text
http://127.0.0.1:8000
```

Dokumentacja OpenAPI jest dostepna pod:

```text
http://127.0.0.1:8000/docs
```

Domyslnie lokalna baza SQLite powstaje jako:

```text
backend/guardy.db
```

Mozna wskazac inna baze przez `DATABASE_URL`, np.:

```powershell
$env:DATABASE_URL="sqlite:///C:/temp/guardy.db"
python -m uvicorn app.main:app --reload
```

## Uruchomienie rozszerzenia Chrome

1. Uruchom backend na porcie `8000`.
2. Otworz w Chrome:

```text
chrome://extensions
```

3. Wlacz tryb deweloperski.
4. Kliknij `Load unpacked`.
5. Wybierz katalog:

```text
frontend/
```

6. Otworz popup rozszerzenia Guardy i sprawdz status polaczenia z backendem.

Domyslny adres backendu zapisany w rozszerzeniu to:

```text
http://localhost:8000
```

Mozna go zmienic w panelu ustawien rozszerzenia.

## Ustawienia rozszerzenia

Rozszerzenie zapisuje ustawienia lokalnie w `chrome.storage.local`. Dostepne opcje:

- adres backendu API;
- opcjonalny klucz VirusTotal API;
- automatyczne porownywanie z VirusTotal po skanie Guardy;
- tryb skanowania: wszystkie klikniecia, tylko linki zewnetrzne albo tryb reczny;
- sposob komunikatu dla bezpiecznych linkow;
- motyw jasny, ciemny albo automatyczny;
- lista domen, dla ktorych skanowanie jest wylaczone;
- historia ostatnich 20 skanow z mozliwoscia eksportu.

## Endpointy API

### `GET /health`

Zwraca status backendu, liczbe zaladowanych profili marek, status modelu ML i status bazy danych.

### `POST /scan/url`

Skanuje URL i zwraca wynik Guardy.

Przykladowe zapytanie:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/scan/url `
  -ContentType "application/json" `
  -Body '{"url":"http://paypal-secure-login.xyz/verify","context":"manual_popup"}'
```

Przykladowa odpowiedz:

```json
{
  "risk_score": 100,
  "decision": "BLOCK",
  "reasons": [
    "Suspicious TLD detected",
    "Suspicious keyword detected: login",
    "Brand keyword used outside official domain: PayPal"
  ],
  "matched_brand": "PayPal",
  "timestamp": "2026-05-11T10:00:00Z"
}
```

### `POST /scan/virustotal`

Pobiera informacyjny wynik VirusTotal dla URL. Wymaga naglowka `X-VT-Key`.

### `GET /brands`

Zwraca profile marek zaladowane do bazy.

### `POST /brands`

Dodaje profil marki. Wymaga naglowka:

```text
X-API-Key: admin_api_key
```

### `GET /audit/logs`

Zwraca stronicowane logi audytowe. Wymaga naglowka `X-API-Key`.

Parametry:

- `page` - numer strony, domyslnie `1`;
- `limit` - liczba rekordow, od `1` do `100`, domyslnie `20`.

## Testy

Testy backendu:

```powershell
cd backend
python -m pytest tests
```

Testy backendu w Dockerze:

```powershell
docker compose run --rm api pytest tests
```

Zakres testow obejmuje m.in. reguly URL, normalizacje, detekcje podszywania sie pod marki, endpointy API, autoryzacje administracyjna i integralnosc lancucha audytowego.

## Struktura katalogow

```text
.
|-- backend/
|   |-- app/
|   |   |-- scanner/
|   |   |-- audit.py
|   |   |-- database.py
|   |   |-- main.py
|   |   |-- models.py
|   |   `-- seed.py
|   |-- ml/
|   |-- seed_data/
|   |-- tests/
|   |-- Dockerfile
|   `-- requirements.txt
|-- frontend/
|   |-- icons/
|   |-- utils/
|   |-- background.js
|   |-- content.js
|   |-- manifest.json
|   |-- popup.html
|   |-- popup.css
|   |-- popup.js
|   |-- settings.html
|   |-- settings.css
|   `-- settings.js
|-- docker-compose.yml
|-- .gitignore
`-- README.md
```

## Struktura backendu

Backend jest podzielony zgodnie z typowa struktura aplikacji FastAPI: punkt wejscia API znajduje sie w `app/main.py`, modele i schematy danych w `app/models.py`, konfiguracja bazy w `app/database.py`, logika domenowa w osobnym pakiecie `app/scanner/`, dane startowe poza kodem aplikacji w `seed_data/`, a testy w `tests/`.

```text
backend/
|-- app/
|   |-- scanner/
|   |   |-- brand_detector.py
|   |   |-- decision_engine.py
|   |   |-- ml_model.py
|   |   |-- normalization.py
|   |   `-- url_analyzer.py
|   |-- audit.py
|   |-- database.py
|   |-- main.py
|   |-- models.py
|   `-- seed.py
|-- ml/
|   |-- features.py
|   |-- train.py
|   `-- guardy_hybrid_ml_training_colab.py
|-- seed_data/
|   |-- brands.json
|   `-- urls.json
|-- tests/
|   `-- test_scanner.py
|-- Dockerfile
`-- requirements.txt
```

Opis najwazniejszych elementow:

- `app/main.py` - konfiguracja FastAPI, CORS, lifecycle aplikacji oraz definicje endpointow;
- `app/models.py` - schematy Pydantic i modele SQLAlchemy;
- `app/database.py` - konfiguracja SQLAlchemy, sesje bazy danych i inicjalizacja tabel;
- `app/audit.py` - zapis logow skanowania i weryfikacja lancucha hashy;
- `app/seed.py` - ladowanie danych startowych marek i adresow URL;
- `app/scanner/url_analyzer.py` - regulowa analiza cech URL;
- `app/scanner/brand_detector.py` - wykrywanie podszywania sie pod marki;
- `app/scanner/decision_engine.py` - laczenie sygnalow w wynik ryzyka i decyzje;
- `app/scanner/ml_model.py` - ladowanie modelu ML i predykcja wyniku pomocniczego;
- `app/scanner/normalization.py` - normalizacja URL przed skanem;
- `ml/features.py` - ekstrakcja cech dla modelu ML zgodna z backendem;
- `ml/train.py` i `ml/guardy_hybrid_ml_training_colab.py` - skrypty eksperymentalne i treningowe;
- `seed_data/brands.json` - rejestr marek, oficjalnych domen i slow kluczowych;
- `tests/test_scanner.py` - testy jednostkowe i integracyjne backendu.

## Struktura frontendu

Frontend jest rozszerzeniem Chrome MV3 bez procesu budowania. Struktura rozdziela pliki wedlug odpowiedzialnosci: `manifest.json` opisuje rozszerzenie, `background.js` obsluguje komunikacje z backendem jako service worker, `content.js` dziala na odwiedzanych stronach, popup i ustawienia maja osobne pliki HTML/CSS/JS, a wspolny klient API znajduje sie w `utils/`.

```text
frontend/
|-- icons/
|   |-- icon-16.png
|   |-- icon-32.png
|   |-- icon-48.png
|   |-- icon-128.png
|   `-- university-logo.svg
|-- utils/
|   `-- api.js
|-- background.js
|-- content.js
|-- manifest.json
|-- popup.html
|-- popup.css
|-- popup.js
|-- settings.html
|-- settings.css
`-- settings.js
```

Opis najwazniejszych elementow:

- `manifest.json` - konfiguracja Manifest V3, uprawnienia, ikony, content script, service worker i options page;
- `background.js` - service worker odbierajacy komunikaty z popupu i content scriptu oraz wykonujacy zapytania do backendu;
- `content.js` - przechwytuje klikniecia w linki, uruchamia skanowanie, pokazuje popup decyzji i obsluguje akcje uzytkownika;
- `popup.html`, `popup.css`, `popup.js` - glowny popup rozszerzenia z recznym skanowaniem, statusem backendu, ostatnim wynikiem i wlaczaniem/wylaczaniem domen;
- `settings.html`, `settings.css`, `settings.js` - panel ustawien, historia skanow, eksport historii, konfiguracja VirusTotal i trybu pracy;
- `utils/api.js` - wspolna warstwa komunikacji przez `chrome.runtime.sendMessage`, ustawienia, historia i zapis wynikow;
- `icons/` - zasoby graficzne rozszerzenia.

## Zmienne srodowiskowe backendu

| Zmienna | Domyslna wartosc | Opis |
| --- | --- | --- |
| `ADMIN_API_KEY` | `admin_api_key` | Klucz wymagany przez endpointy administracyjne. |
| `DATABASE_URL` | `sqlite:///backend/guardy.db` lokalnie, `sqlite:////data/guardy.db` w Dockerze | Adres bazy danych SQLAlchemy. |

## Decyzje skanowania

Backend zwraca jedna z trzech decyzji:

| Decyzja | Zakres wyniku | Znaczenie |
| --- | --- | --- |
| `ALLOW` | `0-29` | Link nie zawiera istotnych sygnalow phishingu. |
| `WARN` | `30-69` | Link wymaga ostroznosci. |
| `BLOCK` | `70-100` | Link jest wysokiego ryzyka. |

## Uwagi dotyczace modelu ML

Backend probuje wczytac model z:

```text
backend/ml/model.pkl
```

Jezeli plik nie istnieje albo nie moze zostac wczytany, status ML w `/health` bedzie wskazywal tryb fallback. Aplikacja nadal dziala, poniewaz glowna decyzja korzysta takze z regul URL i detekcji podszywania sie pod marki.

## Bezpieczenstwo i prywatnosc

- Skanowane adresy URL sa wysylane do lokalnego backendu Guardy.
- Historia rozszerzenia jest przechowywana lokalnie w `chrome.storage.local`.
- Klucz VirusTotal jest przechowywany lokalnie w ustawieniach rozszerzenia.
- Wynik VirusTotal ma charakter informacyjny i nie modyfikuje wyniku Guardy w backendzie.
- Endpointy administracyjne wymagaja naglowka `X-API-Key`.
