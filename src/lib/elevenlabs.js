// Fase 1 — ElevenLabs TTS client
// Implementação completa adicionada na Fase 1 do roadmap.

export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export async function fetchVoicesList() {
  const res = await fetch('/api/voices-list');
  if (!res.ok) throw new Error('Falha ao carregar vozes ElevenLabs');
  return res.json();
}
