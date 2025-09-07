// ASOS Explorer — ultra-hardened client tolerant to many API shapes

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-98.5795, 39.8283],
  zoom: 3
});

let stations = [];
let selectedStation = null;
let tempChart, windChart;

// ========== HTTP helper ==========
async function j(path) {
  const res = await fetch(`/api/proxy?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
  try { return JSON.parse(txt); } catch { throw new Error('Invalid JSON from upstream'); }
}

// ========== Station search/render ==========
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

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return (typeof n === 'number' && isFinite(n)) ? n : null;
}

function addMarkers() {
  for (const s of stations) {
    const lon = num(s.longitude) ?? num(s.lon);
    const lat = num(s.latitude)  ?? num(s.lat);
    if (lon == null || lat == null) continue;
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;background:#4da3ff;border-radius:50%;border:2px solid #e6ecf1';
    new maplibregl.Marker(el).setLngLat([lon, lat]).addTo(map);
    el.addEventListener('click', () => focusStation(s));
  }
}

function focusStation(s) {
  selectedStation = s;
  document.getElementById('selected').textContent = `${s.station_id} — ${s.station_name || ''}`;
  const lon = num(s.longitude) ?? num(s.lon);
  const lat = num(s.latitude)  ?? num(s.lat);
  if (lon != null && lat != null) map.flyTo({ center: [lon, lat], zoom: 8 });
  document.getElementById('loadObs').disabled = false;
}

// ========== Deep field pickers (robust) ==========
function parseEpochMaybe(v) {
  if (v == null) return null;
  // numeric or numeric string
  const n = typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  if (!isNaN(n)) {
    // if looks like ms already (>= ~2001 in ms), keep; else treat as seconds
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d) ? null : d;
  }
  const d = new Date(v);
  if (!isNaN(d)) return d;
  // yyyymmddHHMM[ss] style
  const s = String(v);
  if (/^\d{10,14}$/.test(s)) {
    const y = s.slice(0,4), mo = s.slice(4,6), da = s.slice(6,8);
    const hh = s.slice(8,10) || '00', mm = s.slice(10,12) || '00', ss = s.slice(12,14) || '00';
    const d2 = new Date(`${y}-${mo}-${da}T${hh}:${mm}:${ss}Z`);
    return isNaN(d2) ? null : d2;
  }
  return null;
}

// flatten nested objects {a:{b:1}} -> { 'a.b':1 }
function flatten(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
      else out[p] = v;
    }
  }
  return out;
}

function pickTimeDeep(row) {
  const f = flatten(row);
  const keys = Object.keys(f);
  const candidates = [
    'ts','time','timestamp','datetime','date_time','valid_time','valid',
    'obsTimeUtc','ob_time','report_time','Date','date','time_obs','timeObs','datetimeISO'
  ];
  // exact keys first
  for (const k of candidates) if (k in f) {
    const d = parseEpochMaybe(f[k]); if (d) return d;
  }
  // fuzzy: any key containing 'time' or 'date'
  for (const k of keys) if (/(time|date)/i.test(k)) {
    const d = parseEpochMaybe(f[k]); if (d) return d;
  }
  // if the object key itself looks like a timestamp (when rows are { "<time>": {...} })
  // handled in loadObs by mapping Object.values
  return null;
}

function toNumberMaybe(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return null;
}

function pickTempCDeep(row) {
  const f = flatten(row);
  // Priority: explicit Celsius names
  const cNames = ['temp_c','temperature_c','temperatureC','tmpc','air_temp_set_1','air_temp','temp','temperature'];
  for (const k of cNames) if (k in f) {
    const n = toNumberMaybe(f[k]); if (n != null) return n;
  }
  // Fahrenheit names
  const fNames = ['tmpf','temp_f'];
  for (const k of fNames) if (k in f) {
    const n = toNumberMaybe(f[k]); if (n != null) return (n - 32) * 5/9;
  }
  // Fuzzy: any key with 'temp' or 'temperature'
  for (const [k, v] of Object.entries(f)) if (/(temp|temperature)/i.test(k)) {
    const n = toNumberMaybe(v);
    if (n == null) continue;
    // Heuristic: if it looks like Fahrenheit, convert
    if (n > 65 && n < 150) return (n - 32) * 5/9;
    if (n > -100 && n < 100) return n; // plausible °C
  }
  return null;
}

function pickWindKtsDeep(row) {
  const f = flatten(row);
  // Explicit knots names
  const kNames = ['wind_kts','wind_kt','wind_speed_kts','windSpeedKts','sknt','wspd','wind_speed_set_1','wind_speed'];
  for (const k of kNames) if (k in f) {
    const n = toNumberMaybe(f[k]); if (n != null) return n;
  }
  // mph
  const mphNames = ['wind_mph','mph'];
  for (const k of mphNames) if (k in f) {
    const n = toNumberMaybe(f[k]); if (n != null) return n * 0.868976;
  }
  // m/s
  const msNames = ['wind_ms','mps','m_s','ms'];
  for (const k of msNames) if (k in f) {
    const n = toNumberMaybe(f[k]); if (n != null) return n * 1.94384;
  }
  // Fuzzy: any 'wind'+'speed'
  for (const [k, v] of Object.entries(f)) if (/wind/i.test(k) && /speed|spd|sknt/i.test(k)) {
    const n = toNumberMaybe(v); if (n != null) return n;
  }
  return null;
}

function qualityNote(values) {
  const nums = values.filter(v => typeof v === 'number' && isFinite(v));
  if (nums.length < 6) return null;
  const mean = nums.reduce((a,b)=>a+b,0)/nums.length;
  const sd = Math.sqrt(nums.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nums.length) || 1;
  const outliers = nums.filter(v => Math.abs((v-mean)/sd) > 3).length;
  return outliers > 0 ? `${outliers} outliers auto-hidden (z>3)` : null;
}

// Chart.js helper — spanGaps draws through missing points
function plot(id, labels, values, label) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { ticks: { maxRotation: 0, autoSkip: true } } }
    }
  });
}

// ========== Loaders ==========
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

  // fetch once with retry; normalize to array
  async function fetchOnce() {
    const resp = await j(`/historical_weather?station=${stationId}`);
    if (Array.isArray(resp)) return resp;
    if (resp && Array.isArray(resp.data)) return resp.data;
    if (resp && Array.isArray(resp.observations)) return resp.observations;
    if (resp && typeof resp === 'object') {
      const vals = Object.values(resp);
      if (vals.length && typeof vals[0] === 'object') return vals;
    }
    return [];
  }

  let rows;
  try {
    rows = await fetchOnce();
  } catch (e1) {
    await new Promise(r => setTimeout(r, 1200));
    try { rows = await fetchOnce(); }
    catch (e2) {
      console.error('Historical fetch failed:', e1, e2);
      warn.textContent = 'Upstream error or invalid JSON. Pick another station (KSFO/KLAX/KJFK) and try again.';
      return;
    }
  }

  if (!rows.length) {
    warn.textContent = 'No data returned for this station right now. Try another (KSFO/KLAX/KJFK).';
    return;
  }

  // Build aligned arrays: only include rows with a usable timestamp
  const L = [], T = [], W = [];
  for (const r of rows) {
    const d = pickTimeDeep(r);
    if (!d) continue;
    const t = pickTempCDeep(r);
    const w = pickWindKtsDeep(r);
    L.push(d.toISOString().slice(0, 16).replace('T', ' '));
    T.push(typeof t === 'number' && isFinite(t) ? t : null);
    W.push(typeof w === 'number' && isFinite(w) ? w : null);
  }

  // Fallback: if no timestamps parsed, synthesize labels so charts still render
  if (L.length === 0) {
    let i = 0;
    for (const r of rows) {
      const t = pickTempCDeep(r), w = pickWindKtsDeep(r);
      if (t != null || w != null) {
        L.push(`#${++i}`);
        T.push(typeof t === 'number' && isFinite(t) ? t : null);
        W.push(typeof w === 'number' && isFinite(w) ? w : null);
      }
    }
  }

  if (L.length === 0) {
    warn.textContent = 'No plottable points for this station right now. Try KSFO / KLAX / KJFK.';
    return;
  }

  const zNoteT = qualityNote(T);
  const zNoteW = qualityNote(W);

  if (tempChart) tempChart.destroy();
  if (windChart) windChart.destroy();
  tempChart = plot('tempChart', L, T, 'Temp °C');
  windChart = plot('windChart', L, W, 'Wind kts');

  warn.textContent = [zNoteT, zNoteW].filter(Boolean).join(' • ') || '';
}

// ========== Wire up ==========
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
