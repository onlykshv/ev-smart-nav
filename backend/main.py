"""
main.py  —  FastAPI backend for EV Smart Navigator
Run: py -m uvicorn backend.main:app --reload --port 8000
"""

import os
import json
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from backend.range_predictor import predict_range
from backend.route_planner   import plan_route, _load_stations

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="EV Smart Navigator", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLEAN  = os.path.join(ROOT, "data", "clean")
FRONT  = os.path.join(ROOT, "frontend")

# ── Serve frontend ─────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=FRONT), name="static")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(FRONT, "index.html"))

@app.get("/dashboard")
def serve_dashboard():
    return FileResponse(os.path.join(FRONT, "dashboard.html"))

@app.get("/stations")
def serve_stations():
    return FileResponse(os.path.join(FRONT, "stations.html"))

# ── Load data at startup ───────────────────────────────────────────────────────
_cars_df: pd.DataFrame = None
_country_df: pd.DataFrame = None
_world_df: pd.DataFrame = None

@app.on_event("startup")
def startup():
    global _cars_df, _country_df, _world_df, _all_stations
    _cars_df      = pd.read_csv(os.path.join(CLEAN, "ev_cars.csv"))
    _country_df   = pd.read_csv(os.path.join(CLEAN, "country_summary.csv"))
    _world_df     = pd.read_csv(os.path.join(CLEAN, "world_summary.csv"))
    _all_stations = pd.read_csv(os.path.join(CLEAN, "stations.csv"),
                                usecols=["id","name","latitude","longitude",
                                         "power_kw","power_class","is_fast_dc",
                                         "ports","country_code"])
    _load_stations()   # pre-build KD-Tree (fast-DC only)
    print(f"[startup] Loaded {len(_cars_df)} vehicles, {len(_all_stations)} total stations")

# ── Pydantic models ────────────────────────────────────────────────────────────
class RangeRequest(BaseModel):
    vehicle_id : int
    charge_pct : float = 80.0

class RouteRequest(BaseModel):
    origin_lat  : float
    origin_lon  : float
    dest_lat    : float
    dest_lon    : float
    vehicle_id  : int
    charge_pct  : float = 80.0

# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/api/vehicles")
def get_vehicles(brand: Optional[str] = None):
    df = _cars_df.copy()
    if brand:
        df = df[df["brand"].str.lower() == brand.lower()]
    records = df.fillna("").to_dict(orient="records")
    return {"count": len(records), "vehicles": records}


@app.get("/api/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: int):
    row = _cars_df[_cars_df["Row_ID"] == vehicle_id]
    if row.empty:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return row.fillna("").iloc[0].to_dict()


@app.post("/api/predict-range")
def api_predict_range(req: RangeRequest):
    row = _cars_df[_cars_df["Row_ID"] == req.vehicle_id]
    if row.empty:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    r = row.iloc[0]
    result = predict_range(
        battery_kwh      = float(r["battery_kwh"]),
        efficiency_wh_km = float(r["efficiency_wh_km"]),
        charge_pct       = float(req.charge_pct),
        drive_config     = str(r.get("drive_config", "Rear Wheel Drive")),
        top_speed_kmh    = float(r.get("top_speed_kmh", 180)),
        accel_0_100      = float(r.get("accel_0_100_sec", 7.0)),
    )
    result["vehicle"]    = f"{r['brand']} {r['model']}"
    result["battery_kwh"] = float(r["battery_kwh"])
    return result


@app.get("/api/stations/nearby")
def stations_nearby(
    lat        : float = Query(...),
    lon        : float = Query(...),
    radius_km  : float = Query(default=50.0),
    fast_only  : bool  = Query(default=False),
    limit      : int   = Query(default=100),
):
    from backend.route_planner import _STATIONS, _TREE
    import numpy as np

    if _STATIONS is None or _TREE is None:
        _load_stations()

    # KD-Tree query by radius (approx degrees, 1° ≈ 111 km)
    radius_deg = radius_km / 111.0
    idxs = _TREE.query_ball_point([lat, lon], r=radius_deg)
    result = _STATIONS.iloc[idxs[:limit]].fillna("").to_dict(orient="records")
    return {"count": len(result), "stations": result}


@app.get("/api/stations/bbox")
def stations_bbox(
    min_lat  : float = Query(...),
    max_lat  : float = Query(...),
    min_lon  : float = Query(...),
    max_lon  : float = Query(...),
    fast_only: bool  = Query(default=False),
    limit    : int   = Query(default=2000, le=5000),
):
    """Return stations inside a lat/lon bounding box. Used by the global station map."""
    df = _all_stations
    mask = (
        (df["latitude"]  >= min_lat) & (df["latitude"]  <= max_lat) &
        (df["longitude"] >= min_lon) & (df["longitude"] <= max_lon)
    )
    if fast_only:
        mask &= (df["is_fast_dc"] == 1)
    subset = df[mask].head(limit).fillna("")
    return {
        "count"   : len(subset),
        "capped"  : len(subset) == limit,
        "stations": subset.to_dict(orient="records"),
    }


@app.post("/api/route")
def api_route(req: RouteRequest):
    row = _cars_df[_cars_df["Row_ID"] == req.vehicle_id]
    if row.empty:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    r = row.iloc[0]

    range_result = predict_range(
        battery_kwh      = float(r["battery_kwh"]),
        efficiency_wh_km = float(r["efficiency_wh_km"]),
        charge_pct       = float(req.charge_pct),
        drive_config     = str(r.get("drive_config", "Rear Wheel Drive")),
    )
    range_km = range_result["range_km"]

    route = plan_route(
        origin_lat = req.origin_lat,
        origin_lon = req.origin_lon,
        dest_lat   = req.dest_lat,
        dest_lon   = req.dest_lon,
        range_km   = range_km,
    )
    route["vehicle"]   = f"{r['brand']} {r['model']}"
    route["range_km"]  = range_km
    route["charge_pct"] = req.charge_pct
    return route


@app.get("/api/country-stats")
def country_stats():
    records = _world_df.fillna(0).to_dict(orient="records")
    return {"count": len(records), "countries": records}


@app.get("/api/brands")
def get_brands():
    brands = sorted(_cars_df["brand"].dropna().unique().tolist())
    return {"brands": brands}
