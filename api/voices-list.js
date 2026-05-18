export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'ELEVENLABS_API_KEY não configurada' }); return; }

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) { res.status(r.status).json({ error: `ElevenLabs: ${r.statusText}` }); return; }

    const data = await r.json();
    const voices = (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      labels: v.labels || {},
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.json({ voices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
