"""
clean_data.py
Cleans all 6 raw data files and exports to data/clean/
Run from project root: python scripts/clean_data.py
"""

import os
import re
import pandas as pd
import numpy as np

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW  = os.path.join(ROOT, "RAWS")
OUT  = os.path.join(ROOT, "data", "clean")
os.makedirs(OUT, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# 1. cars_data_RAW.csv  →  ev_cars.csv
# ─────────────────────────────────────────────────────────────────────────────
def clean_cars():
    df = pd.read_csv(os.path.join(RAW, "cars_data_RAW.csv"))

    # Normalise brand names
    df["brand"] = df["title"].str.strip().str.title()
    df["model"] = df["model"].str.strip()

    # ── Numeric conversions ──────────────────────────────────────────────────
    df["battery_kwh"]      = pd.to_numeric(df["battery"],    errors="coerce")
    df["range_km"]         = pd.to_numeric(df["Range*"].astype(str).str.replace(" km",""), errors="coerce")
    df["efficiency_wh_km"] = pd.to_numeric(df["Efficiency*"].astype(str).str.replace(" Wh/km",""), errors="coerce")
    df["top_speed_kmh"]    = pd.to_numeric(df["Top Speed"].astype(str).str.replace(" km/h",""), errors="coerce")
    df["fastcharge_kmh"]   = pd.to_numeric(df["Fastcharge*"].astype(str).str.replace(" km/h","").str.replace("-",""), errors="coerce")
    df["seats"]            = pd.to_numeric(df["Number_of_seats"], errors="coerce")
    df["tow_kg"]           = pd.to_numeric(df["Towing_capacity_in_kg"], errors="coerce").fillna(0)

    # 0-100 seconds
    df["accel_0_100_sec"]  = df["0 - 100"].astype(str).str.extract(r"([\d.]+)").astype(float)

    # Drive config normalise
    df["drive_config"] = df["Drive_Configuration"].str.strip()

    # Tow hitch boolean
    df["has_tow_hitch"] = df["Tow_Hitch"].astype(str).str.contains("Towbar", na=False).astype(int)

    # ── Keep only relevant columns ───────────────────────────────────────────
    keep = [
        "Row_ID", "brand", "model",
        "battery_kwh", "range_km", "efficiency_wh_km",
        "top_speed_kmh", "accel_0_100_sec", "fastcharge_kmh",
        "drive_config", "has_tow_hitch", "tow_kg", "seats"
    ]
    df = df[keep].copy()

    # Drop rows missing core specs
    df = df.dropna(subset=["battery_kwh", "range_km", "efficiency_wh_km"])

    # Remove exact duplicates (same brand + model + battery)
    df = df.drop_duplicates(subset=["brand", "model", "battery_kwh"])

    df = df.reset_index(drop=True)
    out_path = os.path.join(OUT, "ev_cars.csv")
    df.to_csv(out_path, index=False)
    print(f"✅  ev_cars.csv          → {len(df)} rows")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# 2. ev_models.csv  →  ev_models_clean.csv
# ─────────────────────────────────────────────────────────────────────────────
def clean_ev_models():
    df = pd.read_csv(os.path.join(RAW, "ev_models.csv"))

    df["make"]           = df["make"].str.strip().str.title()
    df["model"]          = df["model"].str.strip()
    df["powertrain"]     = df["powertrain"].str.strip().str.upper()
    df["body_style"]     = df["body_style"].str.strip()
    df["origin_country"] = df["origin_country"].str.strip()
    df["first_year"]     = pd.to_numeric(df["first_year"], errors="coerce")
    df["age_2025"]       = pd.to_numeric(df["age_2025"],   errors="coerce")

    df = df.drop_duplicates(subset=["make", "model"])
    df = df.reset_index(drop=True)

    out_path = os.path.join(OUT, "ev_models_clean.csv")
    df.to_csv(out_path, index=False)
    print(f"✅  ev_models_clean.csv  → {len(df)} rows")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# 3. charging_station.csv  →  stations.csv
# ─────────────────────────────────────────────────────────────────────────────
def clean_stations():
    df = pd.read_csv(os.path.join(RAW, "charging_station.csv"))

    # Drop rows missing location or power
    df = df.dropna(subset=["latitude", "longitude"])
    df = df[df["power_kw"].notna() & (df["power_kw"] > 0)]

    # Standardise power_class labels
    power_class_map = {
        "AC_L1_(<7.5kW)"       : "AC_L1",
        "AC_L2_(7.5-21kW)"     : "AC_L2",
        "AC_HIGH_(22-49kW)"    : "AC_HIGH",
        "DC_FAST_(50-149kW)"   : "DC_FAST",
        "DC_ULTRA_(>=150kW)"   : "DC_ULTRA",
        "UNKNOWN"              : "UNKNOWN",
    }
    df["power_class"] = df["power_class"].map(power_class_map).fillna("UNKNOWN")

    # Boolean to int
    df["is_fast_dc"] = df["is_fast_dc"].astype(bool).astype(int)

    # Clean city / state fields
    df["city"]           = df["city"].str.strip().replace("Unknown City", np.nan)
    df["state_province"] = df["state_province"].str.strip().replace("UNKNOWN", np.nan)

    # Keep only useful columns
    keep = ["id", "name", "city", "state_province", "country_code",
            "latitude", "longitude", "ports", "power_kw", "power_class", "is_fast_dc"]
    df = df[keep].copy()
    df = df.reset_index(drop=True)

    out_path = os.path.join(OUT, "stations.csv")
    df.to_csv(out_path, index=False)
    print(f"✅  stations.csv         → {len(df)} rows")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# 4. charging_station_ml.csv  →  stations_ml.csv
# ─────────────────────────────────────────────────────────────────────────────
def clean_stations_ml():
    df = pd.read_csv(os.path.join(RAW, "charging_station_ml.csv"))

    # Fill missing power values with 0 (means no rated power available)
    df["max_power_kw"]    = pd.to_numeric(df["max_power_kw"],    errors="coerce").fillna(0)
    df["median_power_kw"] = pd.to_numeric(df["median_power_kw"], errors="coerce").fillna(0)

    # Ensure integer flag columns
    for col in ["has_fast_dc", "has_ultra_dc", "dc_fast_station_count", "dc_ultra_station_count"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

    # Drop rows with no coordinate
    df = df.dropna(subset=["latitude", "longitude"])
    df = df.reset_index(drop=True)

    out_path = os.path.join(OUT, "stations_ml.csv")
    df.to_csv(out_path, index=False)
    print(f"✅  stations_ml.csv      → {len(df)} rows")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# 5 & 6. country_summary + world_summary  →  copy as-is (already clean)
# ─────────────────────────────────────────────────────────────────────────────
def clean_country_stats():
    for fname in ["country_summary.csv", "world_summary.csv"]:
        df = pd.read_csv(os.path.join(RAW, fname))
        df = df.dropna(how="all")
        out_path = os.path.join(OUT, fname)
        df.to_csv(out_path, index=False)
        print(f"✅  {fname:<24} → {len(df)} rows")


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n🔧  EV Smart Navigator — Data Cleaning\n" + "─"*40)
    clean_cars()
    clean_ev_models()
    clean_stations()
    clean_stations_ml()
    clean_country_stats()
    print("\n✨  All clean files written to data/clean/\n")
