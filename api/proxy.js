// api/proxy.js
// Vercel Serverless Function: proxy + rate limit + safe fallbacks
const BASE = 'https://sfc.windbornesystems.com';

// Simple global token bucket (per lambda instance) – 20 requests/min
let bucket = { tokens: 20, ts: Date.now() };
function take() {
  const now = Date.now();
  const elapsedMin = (now - bucket.ts) / 60000;
  bucket.tokens = Math.min(20, bucket.tokens + elapsedMin * 20);
  bucket.ts = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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
    const upstream = await fetch(`${BASE}${path}`, {
      headers: { accept: 'application/json' }
    });

    const text = await upstream.text();

    // Try to parse JSON; if corrupt, return a safe, valid fallback
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // Graceful fallbacks for the two endpoints we use
      if (String(path).startsWith('/historical_weather')) {
        // Empty time series instead of an error -> UI shows "No data" message
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ station: 'unknown', data: [] });
        return;
      }
      if (String(path).startsWith('/stations')) {
        // Empty list -> UI still renders and allows retries
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json([]);
        return;
      }
      // Unknown endpoint: surface a 502
      res.status(502).json({ error: 'Upstream returned invalid JSON' });
      return;
    }

    // Success path: pass through JSON with CDN-friendly caching
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(upstream.status).json(json);
  } catch (e) {
    res.status(502).json({ error: 'Proxy error', detail: String(e) });
  }
}
