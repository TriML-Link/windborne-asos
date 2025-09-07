// ASOS Explorer — hardened client that tolerates many API shapes

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-98.5795, 39.8283],
  zoom: 3
});

let stations = [];
let selectedStation = null;
let tempChart, windChart;

// ---------- HTTP helper ----------
async function j(path) {
  const res = await fetch(`/api/proxy?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
  try { return JSON.parse(txt); } catch { throw new Error('Invalid JSON from upstream'); }
}

// ---------- Station search/render ----------
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
  if (lon != null && lat != null) {
    map.flyTo({ center: [lon, lat], zoom: 8 });
  }
  document.getElementById('loadObs').disabled = false;
}

// ---------- Field pickers (very tolerant) ----------
function parseEpochMaybe(v) {
  if (v == null) return null;
  // numeric or numeric string?
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
  if (!isNaN(n)) {
    // seconds vs milliseconds
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d) ? null : d;
  }
  // ISO-ish string
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function pickTime(r) {
  // try lots of common keys
  const cands = ['ts','time','timestamp','datetime','date_time','valid_time','valid','obsTimeUtc','ob_time','report_time','Date','date','time_obs','timeObs','datetimeISO'];
  for (const k of cands) {
    if (r[k] != null) {
      const d = parseEpochMaybe(r[k]);
      if (d) return d;
    }
  }
  return null;
}

function pickTempC(r) {
  const table = [
    ['temp_c', v => v],
    ['temperature_c', v => v],
    ['temperatureC', v => v],
    ['tmpc', v => v],                         // NOAA °C
    ['temp', v => v],                         // assume °C
    ['temperature', v => v],
    ['tmpf', v => (v - 32) * 5/9],            // °F -> °C
    ['temp_f', v => (v - 32) * 5/9],
    ['air_temp_set_1', v => v],               // Mesonet style
    ['air_temp', v => v]
  ];
  for (const [k, fn] of table) {
    const v = r[k];
    if (typeof v === 'number' && isFinite(v)) return fn(v);
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return fn(Number(v));
  }
  return null;
}

function pickWindKts(r) {
  const table = [
    ['wind_kts', v => v],
    ['wind_kt', v => v],
    ['wind_speed_kts', v => v],
    ['windSpeedKts', v => v],
    ['sknt', v => v],                         // NOAA knots
    ['wind_speed', v => v],                   // assume kts
    ['wind_mph', v => v * 0.868976],          // mph -> kts
    ['wind_ms', v => v * 1.94384],            // m/s -> kts
    ['wspd', v => v],                         // generic
    ['wind_speed_set_1', v => v]              // Mesonet style (usually m/s but varies)
  ];
  for (const [k, fn] of table) {
    const v = r[k];
    if (typeof v === 'number' && isFinite(v)) return fn(v);
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return fn(Number(v));
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

function plot(id, labels, values, label) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label, data: values, pointRadius: 0, borderWidth: 2, tension: 0.2 }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{ ticks:{ maxRotation:0, autoSkip:true }}}}
  });
}

// ---------- Loaders ----------
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

  // fetch once with retry
  async function fetchOnce() {
    const resp = await j(`/historical_weather?station=${stationId}`);
    // normalize to array
    if (Array.isArray(resp)) return resp;
    if (resp && Array.isArray(resp.data)) return resp.data;
    if (resp && Array.isArray(resp.observations)) return resp.observations;
    // sometimes object keyed by time -> convert
    if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
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

  // map fields with tolerant pickers
  const times = [];
  const temps = [];
  const winds = [];
  for (const r of rows) {
    const d = pickTime(r);
    const t = pickTempC(r);
    const w = pickWindKts(r);
    if (d) times.push(d.toISOString().slice(0, 16).replace('T', ' '));
    else times.push(null); // keep alignment
    temps.push(typeof t === 'number' && isFinite(t) ? t : null);
    winds.push(typeof w === 'number' && isFinite(w) ? w : null);
  }

  // if ALL times are null, synthesize an index so charts still render
  const hasAnyTime = times.some(x => x !== null);
  const labels = hasAnyTime ? times.filter(Boolean) : rows.map((_, i) => `#${i+1}`);

  const zNoteT = qualityNote(temps);
  const zNoteW = qualityNote(winds);
  const clean = arr => arr.map(v => (typeof v === 'number' && isFinite(v) ? v : null));

  if (tempChart) tempChart.destroy();
  if (windChart) windChart.destroy();
  tempChart = plot('tempChart', labels, clean(temps), 'Temp °C');
  windChart = plot('windChart', labels, clean(winds), 'Wind kts');

  warn.textContent = [zNoteT, zNoteW].filter(Boolean).join(' • ') || '';
}

// ---------- Wire up ----------
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
