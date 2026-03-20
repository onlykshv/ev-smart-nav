/* ═══════════════════════════════════════════════════════════════
   app.js  —  EV Smart Navigator Route Planner
═══════════════════════════════════════════════════════════════ */

const API = '';   // relative base — same origin as backend

// ── Map init (CartoDB Dark Matter) ────────────────────────────────────────────
const map = L.map('map', { zoomControl: false }).setView([20, 0], 2);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  subdomains: 'abcd', maxZoom: 20
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// ── State ─────────────────────────────────────────────────────────────────────
let vehicles    = [];
let selectedVehicle = null;
let rangeCircle = null;
let routeLayer  = null;
let stopMarkers = [];
let originMarker= null;
let destMarker  = null;
let originLatLon= null;
let destLatLon  = null;

// ── Custom marker icons ───────────────────────────────────────────────────────
function makeIcon(emoji, bg) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${bg};border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.15)">${emoji}</div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -18]
  });
}

const ICONS = {
  origin : makeIcon('📍', '#4ade80'),
  dest   : makeIcon('🏁', '#f87171'),
  stop   : makeIcon('⚡', '#fbbf24'),
};

// ── On load ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadBrands();
  bindUI();
});

// ── Load brand list ───────────────────────────────────────────────────────────
async function loadBrands() {
  const brandSel = document.getElementById('brandSelect');
  try {
    const res   = await fetch(`${API}/api/brands`);
    const data  = await res.json();
    brandSel.innerHTML = '<option value="">— Select Brand —</option>' +
      data.brands.map(b => `<option value="${b}">${b}</option>`).join('');
  } catch {
    brandSel.innerHTML = '<option>Cannot reach API</option>';
  }
}

// ── Load vehicles for selected brand ─────────────────────────────────────────
async function loadVehiclesByBrand(brand) {
  const vehicleSel = document.getElementById('vehicleSelect');
  vehicleSel.disabled = true;
  vehicleSel.innerHTML = '<option>Loading…</option>';
  try {
    const res  = await fetch(`${API}/api/vehicles?brand=${encodeURIComponent(brand)}`);
    const data = await res.json();
    vehicles   = data.vehicles;
    vehicleSel.innerHTML = '<option value="">— Select Model —</option>' +
      vehicles.map(v => `<option value="${v.Row_ID}">${v.model} (${v.battery_kwh} kWh)</option>`).join('');
    vehicleSel.disabled = false;
  } catch {
    vehicleSel.innerHTML = '<option>Error loading</option>';
  }
}

// ── UI Bindings ───────────────────────────────────────────────────────────────
function bindUI() {
  const brandSel   = document.getElementById('brandSelect');
  const vehicleSel = document.getElementById('vehicleSelect');
  const slider     = document.getElementById('chargeSlider');
  const chargeVal  = document.getElementById('chargeVal');
  const planBtn    = document.getElementById('planRouteBtn');
  const originGeo  = document.getElementById('originGeoBtn');

  // Brand change
  brandSel.addEventListener('change', () => {
    if (brandSel.value) loadVehiclesByBrand(brandSel.value);
    else { vehicleSel.disabled = true; vehicleSel.innerHTML = '<option>Select brand first</option>'; }
    selectedVehicle = null;
    resetRange();
  });

  // Vehicle change
  vehicleSel.addEventListener('change', () => {
    const id = parseInt(vehicleSel.value);
    selectedVehicle = vehicles.find(v => v.Row_ID === id) || null;
    if (selectedVehicle) fetchAndShowRange();
    updatePlanBtn();
  });

  // Slider change
  slider.addEventListener('input', () => {
    const pct = slider.value;
    chargeVal.textContent = `${pct}%`;
    slider.style.setProperty('--progress', `${pct}%`);
    if (selectedVehicle) fetchAndShowRange();
  });

  // Geolocation button
  originGeo.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      originLatLon = [lat, lon];
      document.getElementById('originInput').value = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      setOriginMarker(lat, lon);
      map.setView([lat, lon], 10);
      updatePlanBtn();
    });
  });

  // Origin enter key / blur → geocode
  document.getElementById('originInput').addEventListener('change', e => geocodeInput(e.target.value, 'origin'));
  document.getElementById('destInput').addEventListener('change',   e => geocodeInput(e.target.value, 'dest'));

  // Plan route button
  planBtn.addEventListener('click', planRoute);
}

// ── Geocode address ───────────────────────────────────────────────────────────
async function geocodeInput(query, type) {
  if (!query.trim()) return;
  // Try lat,lon shortcut
  const coords = query.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (coords) {
    const lat = parseFloat(coords[1]), lon = parseFloat(coords[2]);
    if (type === 'origin') { originLatLon = [lat, lon]; setOriginMarker(lat, lon); }
    else                   { destLatLon   = [lat, lon]; setDestMarker(lat, lon);   }
    updatePlanBtn();
    return;
  }
  // Nominatim geocode
  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (!data.length) return;
    const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
    if (type === 'origin') { originLatLon = [lat, lon]; setOriginMarker(lat, lon); }
    else                   { destLatLon   = [lat, lon]; setDestMarker(lat, lon);   }
    updatePlanBtn();
  } catch (e) { console.warn('Geocode failed', e); }
}

// ── Markers ───────────────────────────────────────────────────────────────────
function setOriginMarker(lat, lon) {
  if (originMarker) map.removeLayer(originMarker);
  originMarker = L.marker([lat, lon], { icon: ICONS.origin }).addTo(map);
}
function setDestMarker(lat, lon) {
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([lat, lon], { icon: ICONS.dest }).addTo(map);
}

// ── Range prediction ──────────────────────────────────────────────────────────
async function fetchAndShowRange() {
  if (!selectedVehicle) return;
  const pct = parseInt(document.getElementById('chargeSlider').value);
  const card = document.getElementById('rangeCard');
  const disp = document.getElementById('rangeDisplay');
  const meth = document.getElementById('rangeMethod');

  card.style.display = 'block';
  disp.textContent = '…';

  try {
    const res  = await fetch(`${API}/api/predict-range`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ vehicle_id: selectedVehicle.Row_ID, charge_pct: pct }),
    });
    const data = await res.json();
    disp.textContent  = `${data.range_km} km`;
    meth.textContent  = `${data.method === 'ml' ? 'ML model' : 'Physics formula'} · ${selectedVehicle.battery_kwh} kWh`;
    showRangeCircle(data.range_km);
  } catch { disp.textContent = 'Error'; }
}

function showRangeCircle(rangeKm) {
  if (!originLatLon) return;
  if (rangeCircle) map.removeLayer(rangeCircle);
  rangeCircle = L.circle(originLatLon, {
    radius     : rangeKm * 1000,
    color      : '#4ade80',
    fillColor  : '#4ade80',
    fillOpacity: 0.05,
    weight     : 1.5,
    dashArray  : '6,4',
  }).addTo(map);
}

function resetRange() {
  document.getElementById('rangeCard').style.display = 'none';
  if (rangeCircle) { map.removeLayer(rangeCircle); rangeCircle = null; }
}

function updatePlanBtn() {
  const ready = selectedVehicle && originLatLon && destLatLon;
  document.getElementById('planRouteBtn').disabled = !ready;
}

// ── Plan route ────────────────────────────────────────────────────────────────
async function planRoute() {
  const pct = parseInt(document.getElementById('chargeSlider').value);
  const btn = document.getElementById('planRouteBtn');
  btn.textContent = 'Planning…';
  btn.disabled = true;

  // Clear previous
  clearRoute();

  try {
    const res  = await fetch(`${API}/api/route`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        origin_lat : originLatLon[0],
        origin_lon : originLatLon[1],
        dest_lat   : destLatLon[0],
        dest_lon   : destLatLon[1],
        vehicle_id : selectedVehicle.Row_ID,
        charge_pct : pct,
      }),
    });
    const data = await res.json();
    drawRoute(data);
    showTripSummary(data);
  } catch (e) {
    console.error('Route error', e);
  } finally {
    btn.textContent = 'Plan Route ➜';
    btn.disabled = false;
  }
}

function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  stopMarkers.forEach(m => map.removeLayer(m));
  stopMarkers = [];
  document.getElementById('tripSummary').style.display = 'none';
}

function drawRoute(data) {
  // Draw polyline from GeoJSON geometry
  if (data.geometry) {
    const coords = data.geometry.coordinates.map(c => [c[1], c[0]]);
    routeLayer = L.polyline(coords, {
      color  : '#60a5fa',
      weight : 4,
      opacity: 0.85,
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 340] });
  }

  // Draw charging stops
  (data.stops || []).forEach((stop, i) => {
    const m = L.marker([stop.latitude, stop.longitude], { icon: ICONS.stop })
      .bindPopup(`
        <div class="popup-title">⚡ ${stop.name}</div>
        <div class="popup-row">🔋 Power: <b>${stop.power_kw} kW</b></div>
        <div class="popup-row">🔌 Ports: ${stop.ports}</div>
        <div class="popup-row">Type: ${stop.power_class}</div>
      `)
      .addTo(map);
    stopMarkers.push(m);
  });
}

function showTripSummary(data) {
  const panel = document.getElementById('tripSummary');
  panel.style.display = 'block';

  document.getElementById('sTotalDist').textContent = data.total_distance_km ? `${data.total_distance_km} km` : '—';
  document.getElementById('sTotalDur').textContent  = data.duration_min      ? `${Math.round(data.duration_min)} min` : '—';
  document.getElementById('sStops').textContent     = (data.stops || []).length;
  document.getElementById('sVehicle').textContent   = data.vehicle || '—';

  const stopsList = document.getElementById('stopsList');
  stopsList.innerHTML = (data.stops || []).map((s, i) => `
    <div class="stop-item">
      <div class="stop-num">${i + 1}</div>
      <div class="stop-info">
        <div class="stop-name">${s.name}</div>
        <div class="stop-meta">${s.power_kw} kW · ${s.ports} ports</div>
      </div>
      <div class="power-badge ${s.power_class}">${s.power_class.replace('_', ' ')}</div>
    </div>
  `).join('');

  if (!data.stops?.length) {
    stopsList.innerHTML = '<div style="color:var(--accent);font-size:12px;text-align:center;padding:8px">✅ No charging stop needed!</div>';
  }
}
