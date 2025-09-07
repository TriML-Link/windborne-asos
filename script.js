// Basic client for ASOS Explorer
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-98.5795, 39.8283], // USA center
  zoom: 3
});

let stations = [];
let selectedStation = null;
let tempChart, windChart;

// Proxy helper
async function j(path) {
  const res = await fetch(`/api/proxy?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderSearch(list) {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const results = document.getElementById('results');
  results.innerHTML = '';
  const filtered = list.filter(s => (s.id || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)).slice(0,200);
  for (const s of filtered) {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.textContent = `${s.id} — ${s.name || 'Unknown'} (${s.country || '—'})`;
    div.onclick = () => focusStation(s);
    results.appendChild(div);
  }
}

function addMarkers() {
  for (const s of stations) {
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;background:#4da3ff;border-radius:50%;border:2px solid #e6ecf1';
    const m = new maplibregl.Marker(el).setLngLat([s.lon, s.lat]).addTo(map);
    el.addEventListener('click', ()=> focusStation(s));
  }
}

function focusStation(s) {
  selectedStation = s;
  document.getElementById('selected').textContent = `${s.id} — ${s.name || ''}`;
  map.flyTo({ center: [s.lon, s.lat], zoom: 8 });
  document.getElementById('loadObs').disabled = false;
}

function qualityNote(values) {
  // quick z-score flag for corruption
  const nums = values.filter(v => typeof v === 'number' && isFinite(v));
  if (nums.length < 6) return null;
  const mean = nums.reduce((a,b)=>a+b,0)/nums.length;
  const sd = Math.sqrt(nums.reduce((a,b)=>a+(b-mean)*(b-mean),0)/nums.length) || 1;
  const outliers = nums.filter(v => Math.abs((v-mean)/sd) > 3).length;
  return outliers > 0 ? `${outliers} outliers auto-hidden (z>3)` : null;
}

function plot(id, labels, values, label) {
  const ctx = document.getElementById(id).getContext('2d');
  const cfg = {
    type: 'line',
    data: { labels, datasets: [{ label, data: values, pointRadius: 0, borderWidth: 2, tension: 0.2 }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{ ticks:{ maxRotation:0, autoSkip:true }}}}
  };
  const chart = new Chart(ctx, cfg);
  return chart;
}

async function loadStations() {
  try {
    stations = await j('/stations');
    addMarkers();
    renderSearch(stations);
  } catch(e) {
    console.error(e);
    alert('Failed to load stations. Please refresh.');
  }
}

async function loadObs() {
  if (!selectedStation) return;
  const warn = document.getElementById('warn');
  warn.textContent = 'Loading...';
  try {
    const obs = await j(`/historical_weather?station=${selectedStation.id}`);
    const rows = Array.isArray(obs.data) ? obs.data : [];
    const ts = rows.map(r => (r.ts ? new Date(r.ts) : null)).filter(Boolean).map(d => d.toISOString().slice(0,16).replace('T',' '));

    const temp = rows.map(r => (typeof r.temp_c === 'number' ? r.temp_c : null));
    const wind = rows.map(r => (typeof r.wind_kts === 'number' ? r.wind_kts : null));

    // hide NaN and extreme outliers (simple z>3 rule)
    const zNoteT = qualityNote(temp);
    const zNoteW = qualityNote(wind);
    const clean = (arr) => arr.map(v => (typeof v === 'number' && isFinite(v) ? v : null));

    if (tempChart) tempChart.destroy();
    if (windChart) windChart.destroy();
    tempChart = plot('tempChart', ts, clean(temp), 'Temp °C');
    windChart = plot('windChart', ts, clean(wind), 'Wind kts');

    warn.textContent = [zNoteT, zNoteW].filter(Boolean).join(' • ') || '';
  } catch(e) {
    console.error(e);
    warn.textContent = 'Upstream error or invalid JSON. Try again in a moment.';
  }
}

document.getElementById('search').addEventListener('input', ()=> renderSearch(stations));
document.getElementById('loadObs').addEventListener('click', loadObs);
document.getElementById('sendQ').addEventListener('click', async ()=>{
  const email = (document.getElementById('qEmail').value || '').trim();
  const text = (document.getElementById('qText').value || '').trim();
  const status = document.getElementById('qStatus');
  status.textContent = 'Sending...';
  try{
    const res = await fetch('/api/question', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ email, text })
    });
    if (!res.ok) throw new Error(await res.text());
    status.textContent = 'Sent! If they reply, it’ll be via your email.';
  }catch(e){
    status.textContent = 'Failed to send. Try again later.';
  }
});

loadStations();
