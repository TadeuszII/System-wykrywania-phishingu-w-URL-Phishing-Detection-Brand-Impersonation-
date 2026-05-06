import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BrandProfileORM

BACKEND_DIR = Path(__file__).resolve().parents[1]
SEED_DATA_DIR = BACKEND_DIR / "seed_data"
BRANDS_FILE = SEED_DATA_DIR / "brands.json"
URLS_FILE = SEED_DATA_DIR / "urls.json"


def load_json(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError(f"Seed file must contain a list: {path}")
    return data


def load_seed_urls() -> list[dict]:
    return load_json(URLS_FILE)


def seed_brands(db: Session) -> int:
    if db.scalar(select(BrandProfileORM.id).limit(1)) is not None:
        return 0

    brands = load_json(BRANDS_FILE)
    for brand in brands:
        db.add(
            BrandProfileORM(
                brand_name=brand["brand_name"],
                official_domains=brand["official_domains"],
                keywords=brand["keywords"],
            )
        )
    db.commit()
    return len(brands)


def seed_database(db: Session) -> dict[str, int]:
    brands_inserted = seed_brands(db)
    urls_available = len(load_seed_urls())
    return {
        "brands_inserted": brands_inserted,
        "urls_available": urls_available,
    }
