// Module-level cache — survives warm function re-use on Vercel
let cachedProjectId = null;

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'DEEPGRAM_API_KEY não configurada' }); return; }

  try {
    if (!cachedProjectId) {
      const r = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${apiKey}` },
      });
      if (!r.ok) throw new Error(`Deepgram projects: ${r.status}`);
      const data = await r.json();
      cachedProjectId = data.projects?.[0]?.project_id;
      if (!cachedProjectId) throw new Error('nenhum projeto encontrado na conta Deepgram');
    }

    const r = await fetch(`https://api.deepgram.com/v1/projects/${cachedProjectId}/keys`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment: 'jarvis-stt-temp',
        scopes: ['usage:write'],
        time_to_live_in_seconds: 30,
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Deepgram keys: ${r.status} ${err}`);
    }

    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ key: data.key });
  } catch (e) {
    cachedProjectId = null; // reset cache so next request retries
    res.status(500).json({ error: e.message });
  }
}
