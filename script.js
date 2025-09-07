// Basic client for ASOS Explorer (robust to API field variations)
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-98.5795, 39.8283],
  zoom: 3
});

let stations = [];
let selectedStation = null;
let tempChart, windChart;

// Proxy helper
async function j(path) {
  const res = await fetch(`/api/proxy?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
  try { return JSON.parse(txt); } catch { throw new Error('Invalid JSON from upstream'); }
}

function renderSearch(list) {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const results = document.getElementById('results');
  results.innerHTML = '';

  const filtered = list
    .filter(s =>
      (s.station_id || '').toLowerCase().includes(q) ||
      (s.station_name || '').toLowerCase().includes(q)
    )
    .slice(0, 200);

  for (const s of filtered) {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.textContent = `${s.station_id} — ${s.station_name || 'Unknown'}`;
    div.onclick = () => focusStation(s);
    results.appendChild(div);
  }
}

function addMarkers() {
  for (const s of stations) {
    if (typeof s.longitude !== 'number' || typeof s.latitude !== 'number') continue;
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;background:#4da3ff;border-radius:50%;border:2px solid #e6ecf1';
    new maplibregl.Marker(el).setLngLat([s.longitude, s.latitude]).addTo(map);
    el.addEventListener('click', () => focusStation(s));
  }
}

function focusStation(s) {
  selectedStation = s;
  document.getElementById('selected').textContent = `${s.station_id} — ${s.station_name || ''}`;
  if (typeof s.longitude === 'number' && typeof s.latitude === 'number') {
    map.flyTo({ center: [s.longitude, s.latitude], zoom: 8 });
  }
  document.getElementById('loadObs').disabled = false;
}

function qualityNote(values) {
  const nums = values.filter(v => typeof v === 'number' && isFinite(v));
  if (nums.length < 6) return null;
  const mean = nums.reduce((a,b)=>a+b,0)/nums.length;
  const sd = Math.sqrt(nums.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nums.length) || 1;
  const outliers = nums.filter(v => Math.abs((v-mean)/sd) > 3).length;
  return outliers > 0 ? `${outliers} outliers auto-hidden (z>3)` : null;
}

function plot(id, labels, values, label) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label, data: values, pointRadius: 0, borderWidth: 2, tension: 0.2 }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{ ticks:{ maxRotation:0, autoSkip:true }}}}
  });
}

// ---- flexible mappers for unknown schemas ----
function pickTime(r) {
  return r.ts || r.time || r.timestamp || r.datetime || r.valid_time || r.obsTimeUtc || r.date_time || r.ob_time || null;
}
function pickTempC(r) {
  if (typeof r.temp_c === 'number') return r.temp_c;
  if (typeof r.temperature_c === 'number') return r.temperature_c;
  if (typeof r.temperatureC === 'number') return r.temperatureC;
  if (typeof r.tmpc === 'number') return r.tmpc;             // sometimes celsius
  if (typeof r.tmpf === 'number') return (r.tmpf - 32) * 5/9; // NOAA-style F -> C
  if (typeof r.temp_f === 'number') return (r.temp_f - 32) * 5/9;
  return null;
}
function pickWindKts(r) {
  if (typeof r.wind_kts === 'number') return r.wind_kts;
  if (typeof r.wind_kt === 'number') return r.wind_kt;
  if (typeof r.wind_speed_kts === 'number') return r.wind_speed_kts;
  if (typeof r.windSpeedKts === 'number') return r.windSpeedKts;
  if (typeof r.sknt === 'number') return r.sknt;             // NOAA knots
  if (typeof r.wind_mph === 'number') return r.wind_mph * 0.868976;
  if (typeof r.wind_ms === 'number')  return r.wind_ms  * 1.94384;
  return null;
}

async function loadStations() {
  try {
    stations = await j('/stations');
    addMarkers();
    renderSearch(stations);
  } catch (e) {
    console.error(e);
    alert('Failed to load stations (rate limit or invalid upstream JSON). Please refresh in ~30s.');
  }
}

async function loadObs() {
  if (!selectedStation) return;
  const warn = document.getElementById('warn');
  warn.textContent = 'Loading...';
  const stationId = selectedStation.station_id;

  async function fetchOnce() {
    const resp = await j(`/historical_weather?station=${stationId}`);
    let rows = [];
    if (Array.isArray(resp)) rows = resp;
    else if (resp && Array.isArray(resp.data)) rows = resp.data;
    else if (resp && Array.isArray(resp.observations)) rows = resp.observations;
    else rows = [];
    return rows;
  }

  let rows;
  try {
    rows = await fetchOnce();
  } catch (e1) {
    await new Promise(r => setTimeout(r, 1200));
    try { rows = await fetchOnce(); }
    catch (e2) {
      console.error('Historical fetch failed:', e1, e2);
      warn.textContent = 'Upstream error or invalid JSON. Try again shortly or pick another station (KSFO/KLAX/KJFK).';
      return;
    }
  }

  if (!rows.length) {
    warn.textContent = 'No data returned for this station right now. Try another (KSFO/KLAX/KJFK).';
    return;
  }

  const ts = rows.map(r => {
    const t = pickTime(r);
    if (!t) return null;
    const d = new Date(t);
    return isNaN(d) ? null : d;
  }).filter(Boolean).map(d => d.toISOString().slice(0,16).replace('T',' '));

  const temp = rows.map(r => pickTempC(r));
  const wind = rows.map(r => pickWindKts(r));

  const zNoteT = qualityNote(temp);
  const zNoteW = qualityNote(wind);
  const clean = arr => arr.map(v => (typeof v === 'number' && isFinite(v) ? v : null));

  if (tempChart) tempChart.destroy();
  if (windChart) windChart.destroy();
  tempChart = plot('tempChart', ts, clean(temp), 'Temp °C');
  windChart = plot('windChart', ts, clean(wind), 'Wind kts');

  warn.textContent = [zNoteT, zNoteW].filter(Boolean).join(' • ') || '';
}

document.getElementById('search').addEventListener('input', () => renderSearch(stations));
document.getElementById('loadObs').addEventListener('click', loadObs);
document.getElementById('sendQ').addEventListener('click', async () => {
  const email = (document.getElementById('qEmail').value || '').trim();
  const text = (document.getElementById('qText').value || '').trim();
  const status = document.getElementById('qStatus');
  status.textContent = 'Sending...';
  try {
    const res = await fetch('/api/question', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, text })
    });
    if (!res.ok) throw new Error(await res.text());
    status.textContent = 'Sent! If they reply, it’ll be via your email.';
  } catch (e) {
    status.textContent = 'Failed to send. Try again later.';
  }
});

loadStations();
