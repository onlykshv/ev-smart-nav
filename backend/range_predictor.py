"""
range_predictor.py
Loads the trained model bundle and exposes a predict() function.
"""

import os, pickle
import numpy as np

_BUNDLE = None

def _load():
    global _BUNDLE
    if _BUNDLE is None:
        model_path = os.path.join(os.path.dirname(__file__), "..", "models", "range_predictor.pkl")
        with open(os.path.normpath(model_path), "rb") as f:
            _BUNDLE = pickle.load(f)
    return _BUNDLE


def physics_range(battery_kwh: float, efficiency_wh_km: float, charge_pct: float) -> float:
    """Pure physics estimate: (battery × charge%) / efficiency"""
    return (battery_kwh * charge_pct / 100.0) / (efficiency_wh_km / 1000.0)


def predict_range(battery_kwh: float,
                  efficiency_wh_km: float,
                  charge_pct: float,
                  drive_config: str = "Rear Wheel Drive",
                  top_speed_kmh: float = 180.0,
                  accel_0_100: float = 7.0) -> dict:
    """
    Returns predicted range at the given charge %.
    Uses ML model when possible; falls back to physics formula.
    """
    bundle = _load()
    model  = bundle["model"]
    le     = bundle["label_encoder"]

    phys = physics_range(battery_kwh, efficiency_wh_km, charge_pct)

    try:
        if drive_config in le.classes_:
            drive_enc = le.transform([drive_config])[0]
        else:
            drive_enc = le.transform([le.classes_[0]])[0]

        # Model trained at 100% charge; scale linearly
        X = np.array([[battery_kwh, efficiency_wh_km, drive_enc, top_speed_kmh, accel_0_100]])
        ml_at_100 = float(model.predict(X)[0])
        ml_range  = ml_at_100 * (charge_pct / 100.0)

        return {
            "range_km"     : round(ml_range, 1),
            "physics_km"   : round(phys, 1),
            "method"       : "ml",
            "charge_pct"   : charge_pct,
        }
    except Exception:
        return {
            "range_km"   : round(phys, 1),
            "physics_km" : round(phys, 1),
            "method"     : "physics",
            "charge_pct" : charge_pct,
        }
