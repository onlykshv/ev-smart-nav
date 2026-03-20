/* ═══════════════════════════════════════════════════════════════
   dashboard.js  —  EV Smart Navigator Stats Dashboard
═══════════════════════════════════════════════════════════════ */

const API = '';

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

// ── Choropleth Map — filled country polygons ──────────────────────────────────
async function renderChoropleth(countries) {
  const chorMap = L.map('choroplethMap', { zoomControl: true, scrollWheelZoom: true })
    .setView([25, 15], 2);

  // Dark base tiles without labels so country fills show clearly
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 18, attribution: '© CARTO © OSM'
  }).addTo(chorMap);

  // Label overlay on top (so country names appear above our fill)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 18, opacity: 0.7, zIndex: 500
  }).addTo(chorMap);

  // ── Build data lookup: ISO-A2 → row ────────────────────────────────────────
  const lookup = {};
  const getCount = r => +(r.station_count || r.evse_count || 0);
  countries.forEach(r => {
    const k = (r.country_code || r.country || '').toUpperCase();
    if (k) lookup[k] = r;
  });

  // Use log scale so small countries with few stations are still visible
  const maxCount = Math.max(...countries.map(getCount));
  const logMax   = Math.log1p(maxCount);

  const scale = chroma.scale([
    '#0d1f1a',   // near-zero: almost invisible dark
    '#134e3a',   // low
    '#16a34a',   // medium
    '#4ade80',   // high
    '#bbf7d0',   // very dense (US, China, Europe leaders)
  ]).mode('lab');

  function getColor(count) {
    if (!count) return '#111820';
    return scale(Math.log1p(count) / logMax).hex();
  }

  function featureStyle(feature) {
    const iso2 = (feature.properties.ISO_A2 || feature.properties.iso_a2 || '').toUpperCase();
    const row  = lookup[iso2];
    const cnt  = row ? getCount(row) : 0;
    return {
      fillColor  : getColor(cnt),
      fillOpacity: cnt ? 0.82 : 0.15,
      color      : 'rgba(255,255,255,0.08)',   // very subtle border
      weight     : 0.5,
    };
  }

  let geojsonLayer;

  function onEachFeature(feature, layer) {
    const iso2 = (feature.properties.ISO_A2 || feature.properties.iso_a2 || '').toUpperCase();
    const name = feature.properties.ADMIN || feature.properties.name || iso2;
    const row  = lookup[iso2];
    const cnt  = row ? getCount(row) : 0;
    const ports = row ? +(row.evse_count || row.port_count || 0) : 0;
    const fast  = row ? ((+(row.fast_evse_share || 0)) * 100).toFixed(1) : '—';

    layer.bindTooltip(`
      <div style="font-family:Inter,sans-serif;font-size:12px;line-height:1.6">
        <b style="font-size:13px">${name}</b><br>
        🔌 Stations: <b>${cnt.toLocaleString()}</b><br>
        ⚡ Ports: <b>${ports.toLocaleString()}</b><br>
        🚀 Fast DC share: <b>${fast}%</b>
      </div>`, { sticky: true, className: 'choropleth-tooltip' });

    layer.on({
      mouseover(e) {
        const l = e.target;
        l.setStyle({ fillOpacity: cnt ? 0.97 : 0.25, weight: 1.5, color: 'rgba(255,255,255,0.35)' });
        l.bringToFront();
      },
      mouseout(e) {
        if (geojsonLayer) geojsonLayer.resetStyle(e.target);
      },
      click(e) {
        if (cnt) chorMap.fitBounds(e.target.getBounds(), { padding: [30, 30] });
      }
    });
  }

  // ── Fetch world GeoJSON ───────────────
  try {
    const res  = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json');
    const topo = await res.json();

    // Convert TopoJSON → GeoJSON using topojson-client (must be loaded in HTML)
    const geojson = topojson.feature(topo, topo.objects.countries);

    // world-atlas only has numeric ISO codes; we'll match via a small crosswalk JSON
    const cwRes  = await fetch('https://cdn.jsdelivr.net/gh/lukes/ISO-3166-Countries-with-Regional-Codes@master/all/all.json');
    const cwData = await cwRes.json();
    const numToIso2 = {};
    cwData.forEach(d => { if (d['country-code'] && d['alpha-2']) numToIso2[d['country-code']] = d['alpha-2']; });

    // Attach ISO_A2 to each feature
    geojson.features.forEach(f => {
      const num = String(f.id).padStart(3, '0');
      f.properties.ISO_A2 = numToIso2[num] || '';
    });

    geojsonLayer = L.geoJSON(geojson, { style: featureStyle, onEachFeature }).addTo(chorMap);
  } catch (err) {
    console.warn('GeoJSON load failed, falling back to simple map', err);
  }

  // ── Gradient legend bar ───────────────────────────────────────────────────────
  const leg = document.getElementById('mapLegend');
  const stops = [0, 0.25, 0.5, 0.75, 1].map(s => scale(s).hex());
  const grad  = `linear-gradient(to right, ${stops.join(', ')})`;
  leg.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;width:100%">
      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">0</span>
      <div style="flex:1;height:10px;border-radius:5px;background:${grad}"></div>
      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${maxCount.toLocaleString()} stations</span>
    </div>
    <div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-align:center">Hover over a country for details · Click to zoom in</div>`;
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
