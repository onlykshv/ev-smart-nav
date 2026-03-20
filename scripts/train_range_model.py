"""
train_range_model.py
Trains a Gradient Boosting range predictor and saves it to models/
Run: py scripts/train_range_model.py
"""

import os
import pickle
import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import cross_val_score
from sklearn.metrics import mean_squared_error

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLEAN  = os.path.join(ROOT, "data", "clean")
MODELS = os.path.join(ROOT, "models")
os.makedirs(MODELS, exist_ok=True)

# ── Load cleaned car data ─────────────────────────────────────────────────────
df = pd.read_csv(os.path.join(CLEAN, "ev_cars.csv"))
print(f"Loaded {len(df)} EV records")

# ── Feature engineering ───────────────────────────────────────────────────────
# Encode drive_config as integer
le = LabelEncoder()
df["drive_encoded"] = le.fit_transform(df["drive_config"].fillna("Unknown"))

FEATURES = ["battery_kwh", "efficiency_wh_km", "drive_encoded",
            "top_speed_kmh", "accel_0_100_sec"]
TARGET   = "range_km"

df_model = df[FEATURES + [TARGET]].dropna()
X = df_model[FEATURES].values
y = df_model[TARGET].values

print(f"Training on {len(X)} samples with features: {FEATURES}")

# ── Train Gradient Boosting Regressor ─────────────────────────────────────────
gbr = GradientBoostingRegressor(
    n_estimators=200,
    max_depth=4,
    learning_rate=0.05,
    subsample=0.8,
    random_state=42
)
gbr.fit(X, y)

# Cross-validation RMSE
cv_scores = cross_val_score(gbr, X, y, cv=5, scoring="neg_mean_squared_error")
cv_rmse   = np.sqrt(-cv_scores.mean())
train_rmse = np.sqrt(mean_squared_error(y, gbr.predict(X)))

print(f"\n📊  Model Performance:")
print(f"    Train RMSE : {train_rmse:.1f} km")
print(f"    CV RMSE    : {cv_rmse:.1f} km  (5-fold)")

# Feature importance
print(f"\n📊  Feature Importances:")
for feat, imp in sorted(zip(FEATURES, gbr.feature_importances_), key=lambda x: -x[1]):
    print(f"    {feat:<25} {imp:.3f}")

# ── Physics baseline for comparison ───────────────────────────────────────────
def physics_range(battery_kwh, efficiency_wh_km, charge_pct=100):
    """Pure formula: range = (battery × charge%) / efficiency"""
    return (battery_kwh * charge_pct / 100) / (efficiency_wh_km / 1000)

phys_preds = [physics_range(r["battery_kwh"], r["efficiency_wh_km"])
              for _, r in df_model.iterrows()]
phys_rmse  = np.sqrt(mean_squared_error(y, phys_preds))
print(f"\n📊  Physics formula baseline RMSE: {phys_rmse:.1f} km")
print(f"    ML improves by: {phys_rmse - cv_rmse:.1f} km RMSE")

# ── Save model bundle ─────────────────────────────────────────────────────────
bundle = {
    "model"         : gbr,
    "label_encoder" : le,
    "features"      : FEATURES,
    "cv_rmse"       : cv_rmse,
    "train_rmse"    : train_rmse,
}
out_path = os.path.join(MODELS, "range_predictor.pkl")
with open(out_path, "wb") as f:
    pickle.dump(bundle, f)

print(f"\n✅  Model saved to models/range_predictor.pkl")

# ── Quick smoke test ──────────────────────────────────────────────────────────
print("\n🧪  Smoke tests (100% charge):")
tests = [
    ("Tesla Model 3 LR",  75.0, 150.0, "All Wheel Drive", 201, 4.4),
    ("BYD SEAL 82.5 RWD", 82.5, 165.0, "Rear Wheel Drive", 180, 5.9),
    ("Dacia Spring 25kWh",25.0, 152.0, "Front Wheel Drive", 125, 19.1),
]
for name, bat, eff, drv, spd, a0100 in tests:
    drive_enc  = le.transform([drv])[0] if drv in le.classes_ else 0
    X_test     = np.array([[bat, eff, drive_enc, spd, a0100]])
    ml_range   = gbr.predict(X_test)[0]
    phys100    = physics_range(bat, eff, 100)
    print(f"  {name:<26} physics={phys100:.0f}km  ml={ml_range:.0f}km")
