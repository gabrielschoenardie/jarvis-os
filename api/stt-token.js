export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'ELEVENLABS_API_KEY não configurada' }); return; }

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) throw new Error(`ElevenLabs token: ${r.status}`);
    const { token } = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ key: token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
