# ASOS Explorer — WindBorne Challenge Starter

A minimal, reviewer-friendly web app:
- Interactive map of ASOS stations
- Click a station → fetch & chart historical weather (temp & wind)
- Basic outlier handling + graceful error states
- Built with static HTML/JS, Chart.js, MapLibre, and Vercel Serverless proxy

## One‑Click Deploy (Non‑Tech Friendly)
1) Create a free account at https://vercel.com and install the Vercel CLI (optional).
2) Download this folder as a ZIP and unzip it.
3) In the **Vercel dashboard**, click **New Project → Import** and drag the folder in. Or run:
   ```bash
   vercel
   ```
4) Once deployed, open your public URL. You’re done.

## Local Dev (optional)
```bash
# any static server works
python -m http.server 5173
# serverless functions won’t run locally without vercel dev, so prefer
npm i -g vercel
vercel dev
```

## How it works
- **/api/proxy** forwards requests to `https://sfc.windbornesystems.com`, adds caching, and guards against invalid JSON & rate limit.
- **/api/question** forwards a question to `https://windbornesystems.com/career_applications.json` with your email so they can reply.
- **index.html / script.js** render the map, search, and charts.
- **No API keys** required.

## Submit your application (example cURL)
```bash
curl -X POST https://windbornesystems.com/career_applications.json   -H 'content-type: application/json'   -d '{
    "career_application": {
      "name": "Sreelekha Chowdary Maganti",
      "email": "your@email.com",
      "role": "Software Engineering Intern Product",
      "submission_url": "https://YOUR-DEPLOYED-URL.vercel.app",
      "portfolio_url": "https://github.com/sreelekhamaganti26",
      "resume_url": "https://your-resume-url.pdf",
      "notes": "Built an ASOS Explorer: interactive map, charts, error-tolerant parsing, edge caching & rate limits. Includes POST question widget per prompt."
    }
  }'
```

## Stretch ideas
- Date range filter + precipitation & pressure charts
- Station compare (2–3 stations side-by-side)
- Deep links (`?station=KSFO`)
- Offline caching with Service Worker
