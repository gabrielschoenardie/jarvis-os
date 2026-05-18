export function splitIntoSpeakableChunks(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map(s => s.replace(/\n/g, ' ').trim())
    .filter(s => s.length > 8);
}

export async function callClaude(messages) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`API ${response.status}: ${errorData.error?.message || JSON.stringify(errorData).substring(0, 100)}`);
  }
  const data = await response.json();
  return {
    text: data.content.find(b => b.type === 'text')?.text || '',
    jarvis: data._jarvis,
  };
}
