"""
route_planner.py
Builds a KD-Tree of fast-charge stations and plans routes via OSRM.
"""

import os
import math
import requests
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from typing import List, Dict, Optional

_TREE    = None
_STATIONS = None

OSRM_BASE = "http://router.project-osrm.org"
SAFETY_PCT = 0.20   # recharge when range buffer falls below 20%


def _load_stations():
    global _TREE, _STATIONS
    if _TREE is not None:
        return

    path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "data", "clean", "stations.csv")
    )
    df = pd.read_csv(path)

    # Use only fast DC stations for route planning stops
    fast = df[df["is_fast_dc"] == 1].copy().reset_index(drop=True)
    coords = fast[["latitude", "longitude"]].values
    _TREE     = cKDTree(coords)
    _STATIONS = fast
    print(f"[route_planner] KD-Tree built with {len(fast)} fast-DC stations")


def _haversine(lat1, lon1, lat2, lon2) -> float:
    """Return distance in km between two lat/lon points."""
    R  = 6371.0
    d1 = math.radians(lat2 - lat1)
    d2 = math.radians(lon2 - lon1)
    a  = (math.sin(d1 / 2) ** 2
          + math.cos(math.radians(lat1))
          * math.cos(math.radians(lat2))
          * math.sin(d2 / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def _osrm_route(origin: tuple, dest: tuple) -> Optional[Dict]:
    """Fetch road route from OSRM. Returns steps list or None on error."""
    url = (f"{OSRM_BASE}/route/v1/driving/"
           f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
           f"?overview=full&steps=true&geometries=geojson")
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if data.get("code") == "Ok":
            return data["routes"][0]
    except Exception as e:
        print(f"[route_planner] OSRM error: {e}")
    return None


def _nearest_fast_station(lat: float, lon: float, exclude_ids: set) -> Optional[Dict]:
    """Return nearest fast-DC station record, excluding already-visited ones."""
    _load_stations()
    # Search within 50 km radius
    dists, idxs = _TREE.query([lat, lon], k=20)
    for dist_rad, idx in zip(dists, idxs):
        row = _STATIONS.iloc[idx]
        if row["id"] not in exclude_ids:
            return row.to_dict()
    return None


def plan_route(origin_lat: float, origin_lon: float,
               dest_lat: float, dest_lon: float,
               range_km: float) -> Dict:
    """
    Plan a route from origin to destination with charging stops.
    range_km = predicted range at current charge %.
    """
    _load_stations()

    route_data = _osrm_route((origin_lat, origin_lon), (dest_lat, dest_lon))

    if route_data is None:
        # Fallback: straight-line estimate
        total_dist = _haversine(origin_lat, origin_lon, dest_lat, dest_lon)
        return {
            "total_distance_km": round(total_dist, 1),
            "duration_min"     : None,
            "stops"            : [],
            "geometry"         : None,
            "warning"          : "OSRM unavailable — straight-line distance only",
        }

    total_dist   = route_data["distance"] / 1000.0
    total_dur    = route_data["duration"] / 60.0
    geometry     = route_data["geometry"]      # GeoJSON LineString
    coords_geojson = geometry["coordinates"]   # [[lon, lat], ...]

    stops      = []
    visited    = set()
    remaining  = range_km
    prev_point = (origin_lat, origin_lon)

    for coord in coords_geojson[::5]:            # sample every 5th coord
        lon, lat   = coord
        step_dist  = _haversine(prev_point[0], prev_point[1], lat, lon)
        remaining -= step_dist
        prev_point = (lat, lon)

        if remaining <= range_km * SAFETY_PCT:
            station = _nearest_fast_station(lat, lon, visited)
            if station:
                visited.add(station["id"])
                stops.append({
                    "station_id"  : int(station["id"]),
                    "name"        : station.get("name", "Charging Station"),
                    "latitude"    : float(station["latitude"]),
                    "longitude"   : float(station["longitude"]),
                    "power_kw"    : float(station.get("power_kw", 0)),
                    "power_class" : station.get("power_class", "DC_FAST"),
                    "ports"       : int(station.get("ports", 1)),
                })
                # Assume full recharge at each stop
                remaining = range_km

    return {
        "total_distance_km" : round(total_dist, 1),
        "duration_min"      : round(total_dur, 1),
        "stops"             : stops,
        "geometry"          : geometry,
        "num_stops"         : len(stops),
    }
