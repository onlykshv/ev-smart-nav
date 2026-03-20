# ⚡ EV Smart Navigator

A full-stack smart EV navigation and range prediction system built with Python (FastAPI), Leaflet.js, and scikit-learn.

![Route Planner](https://raw.githubusercontent.com/onlykshv/ev-smart-nav/main/docs/screenshot.png)

## Features

- 🔋 **Range Prediction** — ML model (Gradient Boosting) predicts how far any EV can travel at a given charge %, trained on 350+ real EV specs
- 🗺️ **Route Planner** — Enter origin & destination; the system auto-inserts fast-DC charging stops based on your vehicle's predicted range
- 🌍 **Stats Dashboard** — Choropleth world map, bar chart (top 20 countries), and donut chart (fast DC vs AC share) across 242k+ stations globally
- 💯 **Fully free** — No API keys required (Leaflet.js, CartoDB tiles, OSRM routing, Nominatim geocoding)

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python — FastAPI + uvicorn |
| ML Model | scikit-learn (Gradient Boosting Regressor) |
| Routing | OSRM public API |
| Geocoding | Nominatim (OpenStreetMap) |
| Map | Leaflet.js + CartoDB Dark Matter tiles |
| Spatial Index | scipy KD-Tree (fast charging stops) |
| Charts | Chart.js 4 + chroma.js |

## Project Structure

```
ev-smart-nav/
├── RAWS/                    # Raw CSV datasets (not committed)
├── data/clean/              # Cleaned CSVs (generated)
├── models/                  # Trained model pkl (generated)
├── scripts/
│   ├── clean_data.py        # Data cleaning pipeline
│   └── train_range_model.py # ML model training
├── backend/
│   ├── main.py              # FastAPI app + all endpoints
│   ├── range_predictor.py   # Range prediction module
│   └── route_planner.py     # KD-Tree + OSRM route planner
└── frontend/
    ├── index.html           # Route planner page
    ├── dashboard.html       # Stats dashboard page
    ├── app.js               # Route planner logic
    ├── dashboard.js         # Dashboard charts + map
    └── style.css            # Dark glassmorphism styles
```

## Setup & Run

### 1. Install dependencies
```bash
pip install fastapi uvicorn[standard] scipy pandas scikit-learn requests
```

### 2. Add raw data
Place the following CSV files in `RAWS/`:
- `cars_data_RAW.csv`
- `ev_models.csv`
- `charging_station.csv`
- `charging_station_ml.csv`
- `country_summary.csv`
- `world_summary.csv`

### 3. Clean data
```bash
py scripts/clean_data.py
```

### 4. Train the model
```bash
py scripts/train_range_model.py
```

### 5. Start the server
```bash
py -m uvicorn backend.main:app --port 8000
```

Open **http://localhost:8000** in your browser.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/vehicles` | List all EVs (filter by `?brand=Tesla`) |
| GET | `/api/vehicles/{id}` | Single EV detail |
| POST | `/api/predict-range` | Predict range `{vehicle_id, charge_pct}` |
| GET | `/api/stations/nearby` | Nearby stations `?lat=&lon=&radius_km=` |
| POST | `/api/route` | Full route with charging stops |
| GET | `/api/country-stats` | Country-level charging infra stats |
| GET | `/api/brands` | List of all EV brands |

## Data Sources

- **EV Specs:** `cars_data_RAW.csv` — 354 EV models with battery, range, efficiency data
- **Charging Stations:** `charging_station.csv` — 242,000+ stations worldwide (lat/lon, power class, fast-DC flag)
- **Country Stats:** `country_summary.csv` / `world_summary.csv` — 122 countries

## License

MIT
