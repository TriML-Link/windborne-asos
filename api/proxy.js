// api/proxy.js
const BASE = 'https://sfc.windbornesystems.com';

let bucket = { tokens: 20, ts: Date.now() }; // coarse global bucket
function take() {
  const now = Date.now();
  const elapsed = (now - bucket.ts) / 60000;
  bucket.tokens = Math.min(20, bucket.tokens + elapsed * 20);
  bucket.ts = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export default async function handler(req, res) {
  const path = req.query.path;
  if (!path || !String(path).startsWith('/')) {
    res.status(400).json({ error: 'Missing or invalid path' });
    return;
  }
  if (!take()) {
    res.status(429).json({ error: 'Rate limit: 20/min. Please retry shortly.' });
    return;
  }
  try {
    const upstream = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
    const text = await upstream.text();
    let json;
    try { json = JSON.parse(text); }
    catch { res.status(502).json({ error: 'Upstream returned invalid JSON' }); return; }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(upstream.status).json(json);
  } catch (e) {
    res.status(502).json({ error: 'Proxy error', detail: String(e) });
  }
}
