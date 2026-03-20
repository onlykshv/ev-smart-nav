/* ═══════════════════════════════════════════════════════════════
   stations.js  —  Global EV Station Map
   Uses MarkerCluster + bbox-based lazy loading
═══════════════════════════════════════════════════════════════ */

const API = '';
let fastOnly   = false;
let clusterLayer = null;
let totalLoaded  = 0;
let loadDebounce = null;

// ── Power class → marker colour ───────────────────────────────────────────────
const POWER_COLORS = {
  DC_ULTRA : '#4ade80',
  DC_FAST  : '#60a5fa',
  AC_HIGH  : '#fbbf24',
  AC_L2    : '#94a3b8',
  AC_L1    : '#64748b',
  UNKNOWN  : '#475569',
};

function stationColor(power_class) {
  return POWER_COLORS[power_class] || POWER_COLORS.UNKNOWN;
}

function makeStationIcon(power_class) {
  const col = stationColor(power_class);
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${col};
      border-radius:50%;
      width:10px;height:10px;
      box-shadow:0 0 4px ${col}88;
      border:1.5px solid rgba(255,255,255,0.3);
    "></div>`,
    iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -8]
  });
}

// ── Map init ──────────────────────────────────────────────────────────────────
const map = L.map('stationsMap', { zoomControl: false }).setView([30, 10], 3);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  subdomains: 'abcd', maxZoom: 20
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// ── Marker cluster ────────────────────────────────────────────────────────────
function newClusterLayer() {
  return L.markerClusterGroup({
    maxClusterRadius      : 50,
    spiderfyOnMaxZoom     : true,
    showCoverageOnHover   : false,
    zoomToBoundsOnClick   : true,
    chunkedLoading        : true,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size  = count > 1000 ? 44 : count > 100 ? 36 : 28;
      const col   = count > 1000 ? '#4ade80' : count > 100 ? '#60a5fa' : '#fbbf24';
      return L.divIcon({
        html: `<div style="
          background:${col}22;
          border:2px solid ${col};
          color:${col};
          border-radius:50%;
          width:${size}px;height:${size}px;
          display:flex;align-items:center;justify-content:center;
          font-family:Inter,sans-serif;
          font-size:${count > 9999 ? 9 : 11}px;
          font-weight:700;
        ">${count > 9999 ? '10k+' : count.toLocaleString()}</div>`,
        className: '',
        iconSize: [size, size],
      });
    }
  });
}

clusterLayer = newClusterLayer();
clusterLayer.addTo(map);

// ── Bbox load ─────────────────────────────────────────────────────────────────
let loadedBboxes = new Set(); // track what we've already loaded to avoid re-fetch

async function loadBbox(bounds) {
  const minLat = bounds.getSouth().toFixed(4);
  const maxLat = bounds.getNorth().toFixed(4);
  const minLon = bounds.getWest().toFixed(4);
  const maxLon = bounds.getEast().toFixed(4);

  // Clamp to valid range
  if (parseFloat(minLon) < -180 || parseFloat(maxLon) > 180) return;

  const key = `${minLat},${maxLat},${minLon},${maxLon},${fastOnly}`;
  if (loadedBboxes.has(key)) return;

  showLoading(true);

  try {
    const url = `${API}/api/stations/bbox?min_lat=${minLat}&max_lat=${maxLat}&min_lon=${minLon}&max_lon=${maxLon}&fast_only=${fastOnly}&limit=2000`;
    const res  = await fetch(url);
    const data = await res.json();

    const markers = [];
    (data.stations || []).forEach(st => {
      if (!st.latitude || !st.longitude) return;
      const m = L.marker([st.latitude, st.longitude], {
        icon: makeStationIcon(st.power_class)
      }).bindPopup(`
        <div class="popup-title" style="color:${stationColor(st.power_class)}">
          🔌 ${st.name || 'Charging Station'}
        </div>
        <div class="popup-row">⚡ Power: <b>${st.power_kw} kW</b></div>
        <div class="popup-row">🔌 Ports: ${st.ports}</div>
        <div class="popup-row">Type: ${st.power_class || 'Unknown'}</div>
        <div class="popup-row">Country: ${st.country_code || '—'}</div>
        ${st.is_fast_dc ? '<div class="popup-row" style="color:var(--accent);margin-top:3px">⚡ Fast DC Charger</div>' : ''}
      `, { maxWidth: 220 });
      markers.push(m);
    });

    clusterLayer.addLayers(markers);
    totalLoaded += markers.length;
    loadedBboxes.add(key);

    updateCount();

    if (data.capped) {
      // If we hit the limit, don't cache — zoom in will load finer detail
      loadedBboxes.delete(key);
    }
  } catch (e) {
    console.warn('Station load error:', e);
  } finally {
    showLoading(false);
  }
}

function updateCount() {
  const total = clusterLayer.getLayers().length;
  document.getElementById('stationCount').textContent =
    `${total.toLocaleString()} stations visible`;
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('show', show);
}

// ── Map move → reload ─────────────────────────────────────────────────────────
function scheduleLoad() {
  clearTimeout(loadDebounce);
  loadDebounce = setTimeout(() => loadBbox(map.getBounds()), 400);
}

map.on('moveend', scheduleLoad);
map.on('zoomend', scheduleLoad);

// Initial load on page ready
scheduleLoad();

// ── Filter ────────────────────────────────────────────────────────────────────
function setFilter(mode) {
  fastOnly = (mode === 'fast');

  document.getElementById('filterAll').classList.toggle('active', !fastOnly);
  document.getElementById('filterFast').classList.toggle('active', fastOnly);

  // Reset and reload
  clusterLayer.clearLayers();
  loadedBboxes.clear();
  totalLoaded = 0;
  updateCount();
  scheduleLoad();
}
