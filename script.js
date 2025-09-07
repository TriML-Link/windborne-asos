// Basic client for ASOS Explorer (fixed field names)
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderSearch(list) {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const results = document.getElementById('results');
  results.innerHTML = '';

  // Use station_id / station_name (NOT id/name)
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
    const obs = await j(`/historical_weather?station=${stationId}`);
    if (!obs || !Array.isArray(obs.data)) throw new Error('Bad payload');
    return obs;
  }

  let obs;
  try {
    obs = await fetchOnce();
  } catch (_e) {
    // Retry once — upstream is flaky sometimes
    try {
      obs = await fetchOnce();
    } catch (e2) {
      console.error('Historical fetch failed:', e2);
      warn.textContent = 'No data right now for this station. Try another (e.g., KSFO, KLAX, KJFK).';
      return;
    }
  }

  const rows = Array.isArray(obs.data) ? obs.data : [];
  if (rows.length === 0) {
    warn.textContent = 'No data available for this station. Try another (e.g., KSFO, KLAX, KJFK).';
    return;
  }

  const ts = rows.map(r => (r.ts ? new Date(r.ts) : null))
                 .filter(Boolean)
                 .map(d => d.toISOString().slice(0,16).replace('T',' '));

  const temp = rows.map(r => (typeof r.temp_c === 'number' ? r.temp_c : null));
  const wind = rows.map(r => (typeof r.wind_kts === 'number' ? r.wind_kts : null));

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
