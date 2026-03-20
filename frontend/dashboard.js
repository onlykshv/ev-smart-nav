/* ═══════════════════════════════════════════════════════════════
   dashboard.js  —  EV Smart Navigator Stats Dashboard
═══════════════════════════════════════════════════════════════ */

const API = '';

// ── Country code → centroids (subset for map circles) ─────────────────────────
// We'll use Nominatim to avoid bundling a full GeoJSON
const COUNTRY_CENTROIDS = {
  US:[-98.583,39.833], CN:[104.195,35.861], DE:[10.451,51.165], NL:[5.291,52.133],
  FR:[2.213,46.228], GB:[-3.436,55.378], NO:[8.468,60.472], KR:[127.766,35.908],
  AU:[133.775,-25.274], CA:[-96.821,56.130], JP:[138.252,36.204], BE:[4.469,50.503],
  SE:[18.643,60.128], IT:[12.567,41.872], AT:[14.550,47.516], CH:[8.228,46.818],
  DK:[9.502,56.263], FI:[25.748,61.924], ES:[-3.749,40.463], PL:[19.145,51.920],
  NZ:[172.013,-40.900], PT:[-8.224,39.400], CZ:[15.473,49.818], HU:[19.503,47.163],
  RO:[24.967,45.944], LU:[6.130,49.816], SK:[19.699,48.669], SI:[14.996,46.152],
  HR:[15.200,45.100], BG:[25.485,42.734], LT:[23.881,55.170], LV:[24.603,56.880],
  EE:[25.013,58.596], GR:[21.824,39.074], CY:[33.429,35.127], MT:[14.376,35.937],
  IE:[-8.244,53.413], RS:[21.005,44.017], MK:[21.745,41.608], AL:[20.169,41.154],
  BA:[17.679,43.916], ME:[19.374,42.708], XK:[20.903,42.602], IS:[-18.998,64.963],
  ZA:[25.084,-29.001], IN:[78.963,20.594], BR:[-51.926,-14.235], MX:[-102.552,23.634],
  CL:[-71.543,-35.675], AR:[-63.617,-38.416], CO:[-74.180,4.571], PE:[-75.016,-9.190],
  TH:[100.993,15.870], MY:[109.698,4.210], SG:[103.820,1.357], NL_:[5,52.3],
  SA:[45.079,23.886], AE:[53.848,23.424], QA:[51.183,25.354], TR:[35.243,38.963],
  IL:[34.852,31.046], ZA_:[25,-29],
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const data = await fetchStats();
  if (!data) return;
  renderKPIs(data.countries);
  renderChoropleth(data.countries);
  renderBarChart(data.countries);
  renderDonut(data.countries);
}

async function fetchStats() {
  try {
    const res = await fetch(`${API}/api/country-stats`);
    return await res.json();
  } catch { return null; }
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function renderKPIs(countries) {
  const total    = row => +(row.station_count || row.evse_count || 0);
  const totalSt  = countries.reduce((s, r) => s + total(r), 0);
  const totalPrt = countries.reduce((s, r) => s + +(r.evse_count || r.port_count || 0), 0);
  const fastRows = countries.filter(r => r.fast_evse_share != null);
  const avgFast  = fastRows.length
    ? fastRows.reduce((s, r) => s + +r.fast_evse_share, 0) / fastRows.length
    : 0;

  document.getElementById('totalCountries').textContent = countries.length;
  document.getElementById('totalStations').textContent  = totalSt.toLocaleString();
  document.getElementById('totalPorts').textContent     = totalPrt.toLocaleString();
  document.getElementById('globalFastShare').textContent= `${(avgFast * 100).toFixed(1)}%`;
}

// ── Choropleth Map ────────────────────────────────────────────────────────────
function renderChoropleth(countries) {
  const chorMap = L.map('choroplethMap', { zoomControl: true }).setView([30, 10], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 18,
    attribution: '© CARTO © OSM'
  }).addTo(chorMap);

  // Build lookup by country code
  const lookup = {};
  const getCount = r => +(r.station_count || r.evse_count || 0);
  countries.forEach(r => { const k = r.country_code || r.country; if (k) lookup[k] = r; });
  const max = Math.max(...countries.map(getCount));
  const scale = chroma.scale(['#1a2d2a', '#4ade80']).mode('lab');

  // Draw circles on centroid positions
  Object.entries(COUNTRY_CENTROIDS).forEach(([cc, [lon, lat]]) => {
    const row = lookup[cc];
    if (!row) return;
    const cnt  = getCount(row);
    const frac = cnt / max;
    const col  = scale(frac).hex();
    const r    = 8 + frac * 40;
    L.circleMarker([lat, lon], {
      radius     : r,
      fillColor  : col,
      color      : col,
      fillOpacity: 0.7,
      weight     : 0,
    })
    .bindPopup(`
      <b>${row.country || cc}</b><br>
      Stations: ${cnt.toLocaleString()}<br>
      Fast share: ${((+(row.fast_evse_share || 0)) * 100).toFixed(1)}%
    `)
    .addTo(chorMap);
  });

  // Legend
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const leg = document.getElementById('mapLegend');
  leg.innerHTML = steps.map(s => {
    const col = scale(s).hex();
    const lab = s === 0 ? 'Few' : s === 1 ? 'Most' : '';
    return `<div class="legend-item"><div class="legend-swatch" style="background:${col}"></div> ${lab}</div>`;
  }).join('');
}

// ── Bar Chart ─────────────────────────────────────────────────────────────────
function renderBarChart(countries) {
  const getCount = r => +(r.evse_count || r.port_count || r.station_count || 0);
  const top20 = [...countries]
    .sort((a, b) => getCount(b) - getCount(a))
    .slice(0, 20);

  const labels = top20.map(r => r.country || r.country_code);
  const values = top20.map(getCount);

  new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label     : 'Charging Ports',
        data      : values,
        backgroundColor: values.map((v, i) =>
          `hsla(${142 - i * 4}, 70%, ${55 - i * 1.2}%, 0.85)`),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins   : { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${ctx.parsed.y.toLocaleString()} ports`
      }}},
      scales: {
        x: { ticks: { color: '#8b949e', font: { size: 11 } }, grid: { color: '#1e2730' } },
        y: { ticks: { color: '#8b949e', font: { size: 11 } }, grid: { color: '#1e2730' } },
      }
    }
  });
}

// ── Donut Chart ───────────────────────────────────────────────────────────────
function renderDonut(countries) {
  // Aggregate fast DC vs AC
  let fastPorts = 0, acPorts = 0;
  countries.forEach(r => {
    const total = +(r.evse_count || r.port_count || 0);
    const share = +(r.fast_evse_share || 0);
    fastPorts += total * share;
    acPorts   += total * (1 - share);
  });

  const COLORS = ['#4ade80', '#60a5fa', '#fbbf24'];
  const labels = ['Fast DC', 'AC Standard'];
  const values = [fastPorts, acPorts];

  new Chart(document.getElementById('donutChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data           : values,
        backgroundColor: COLORS,
        borderColor    : '#0d1117',
        borderWidth    : 3,
        hoverOffset    : 6,
      }]
    },
    options: {
      cutout : '70%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: ctx => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct   = ((ctx.parsed / total) * 100).toFixed(1);
            return ` ${pct}% (${Math.round(ctx.parsed).toLocaleString()})`;
          }
        }}
      }
    }
  });

  // Custom legend
  const leg = document.getElementById('donutLegend');
  leg.innerHTML = labels.map((l, i) => `
    <div class="donut-legend-item">
      <div class="donut-swatch" style="background:${COLORS[i]}"></div>
      <span>${l}</span>
    </div>
  `).join('');
}
