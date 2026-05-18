export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export async function fetchVoicesList() {
  const res = await fetch('/api/voices-list');
  if (!res.ok) throw new Error(`voices-list: ${res.status}`);
  return res.json();
}
