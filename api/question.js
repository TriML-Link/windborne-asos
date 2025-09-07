// api/question.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { email, text } = req.body || {};
    if (!email || !text) {
      res.status(400).json({ error: 'email and text required' });
      return;
    }
    const payload = {
      career_application: {
        name: "ASOS Explorer Question",
        email,
        role: "Software Engineering Intern Product",
        submission_url: "https://example.com",
        portfolio_url: "https://example.com",
        resume_url: "https://example.com",
        notes: `Question from webapp:\n${text}`
      }
    };
    const upstream = await fetch('https://windbornesystems.com/career_applications.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const bodyText = await upstream.text();
    try { res.status(upstream.status).json(JSON.parse(bodyText)); }
    catch { res.status(upstream.status).json({ ok: true }); }
  } catch (e) {
    res.status(500).json({ error: 'Failed to send question', detail: String(e) });
  }
}
