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

export async function callClaude(messages, { onChunk } = {}) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: !!onChunk }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`API ${response.status}: ${errorData.error?.message || JSON.stringify(errorData).substring(0, 100)}`);
  }

  if (!onChunk) {
    const data = await response.json();
    return {
      text: data.content.find(b => b.type === 'text')?.text || '',
      jarvis: data._jarvis,
    };
  }

  const jarvisMeta = response.headers.get('X-Jarvis-Meta');
  const jarvis = jarvisMeta ? JSON.parse(jarvisMeta) : null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let tokenUsage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (json === '[DONE]') continue;
      try {
        const ev = JSON.parse(json);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          fullText += ev.delta.text;
          onChunk(ev.delta.text, fullText);
        } else if (ev.type === 'jarvis_tokens') {
          tokenUsage = { input: ev.input, output: ev.output };
        }
      } catch (_) {}
    }
  }

  return { text: fullText, jarvis, tokenUsage };
}
