# System-wykrywania-phishingu-w-URL-Phishing-Detection-Brand-Impersonation-

## Backend Guardy

Backend to aplikacja FastAPI uruchamiana z katalogu `backend/`.

### Uruchomienie lokalne

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

API będzie dostępne pod adresem `http://127.0.0.1:8000`.

### Uruchomienie przez Docker

```powershell
docker compose up --build
```

Domyślny klucz admina dla endpointów `POST /brands` i `GET /audit/logs` to `admin_api_key`.
Można go zmienić przez zmienną środowiskową `ADMIN_API_KEY`.

### Testy backendu

```powershell
cd backend
python -m pytest tests
```

W Dockerze:

```powershell
docker compose run --rm api pytest tests
```

### Główne endpointy

- `GET /health`
- `POST /scan/url`
- `POST /scan/virustotal`
- `GET /brands`
- `POST /brands`
- `GET /audit/logs`
