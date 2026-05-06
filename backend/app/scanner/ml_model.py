import pickle
from pathlib import Path
from typing import Any

try:
    from ml.features import FEATURE_NAMES_USED, extract_model_features
except ModuleNotFoundError:
    from backend.ml.features import FEATURE_NAMES_USED, extract_model_features

BACKEND_DIR = Path(__file__).resolve().parents[2]
MODEL_PATH = BACKEND_DIR / "ml" / "model.pkl"
FALLBACK_SCORE = 0.5


class MLModel:
    def __init__(self, model_path: Path = MODEL_PATH) -> None:
        self.model_path = model_path
        self.model: Any | None = None
        self.status = "missing"
        self.load()

    def load(self) -> None:
        if not self.model_path.exists():
            self.status = "fallback"
            return

        try:
            with self.model_path.open("rb") as file:
                self.model = pickle.load(file)
            self.status = "loaded"
        except Exception:
            self.model = None
            self.status = "fallback"

    def predict(self, url: str) -> float:
        if self.model is None:
            return FALLBACK_SCORE

        try:
            features = build_feature_frame(url)
            if hasattr(self.model, "predict_proba"):
                probability = self.model.predict_proba(features)[0][1]
                return clamp_score(float(probability))
            if hasattr(self.model, "predict"):
                prediction = self.model.predict(features)[0]
                return clamp_score(float(prediction))
        except Exception:
            return FALLBACK_SCORE

        return FALLBACK_SCORE


def clamp_score(value: float) -> float:
    return max(0.0, min(1.0, value))


def build_feature_frame(url: str) -> Any:
    values = extract_model_features(url)
    try:
        import pandas as pd

        return pd.DataFrame([values], columns=FEATURE_NAMES_USED)
    except Exception:
        return [values]


ml_model = MLModel()


def predict_ml_score(url: str) -> float:
    return ml_model.predict(url)


def get_ml_status() -> str:
    return ml_model.status
