export function splitIntoSpeakableChunks(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    // "10°C" é mostrado corretamente na tela, mas o TTS lê o símbolo de grau de
    // forma estranha (ex: "10 degres") — converte pra forma falada em PT-BR antes
    // de chegar no ElevenLabs/Web Speech.
    .replace(/(-)?(\d+(?:[.,]\d+)?)\s*°\s*C\b/gi, (_, neg, num) => `${neg ? 'menos ' : ''}${num} graus Celsius`)
    .replace(/(-)?(\d+(?:[.,]\d+)?)\s*°\s*F\b/gi, (_, neg, num) => `${neg ? 'menos ' : ''}${num} graus Fahrenheit`)
    .replace(/(-)?(\d+(?:[.,]\d+)?)\s*°/g, (_, neg, num) => `${neg ? 'menos ' : ''}${num} graus`)
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map(s => s.replace(/\n/g, ' ').trim())
    .filter(s => s.length > 0);
}

export async function callClaude(messages, { onChunk, onAction, onToolStatus } = {}) {
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
    const actions = data._jarvis?.actions || [];
    actions.forEach(a => onAction?.(a));
    return {
      text: data.content.find(b => b.type === 'text')?.text || '',
      jarvis: data._jarvis,
      actions,
    };
  }

  const jarvisMeta = response.headers.get('X-Jarvis-Meta');
  const jarvis = jarvisMeta ? JSON.parse(jarvisMeta) : null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let tokenUsage = null;
  let streamError = null;
  const actions = [];

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
        } else if (ev.type === 'jarvis_action') {
          // Ação a executar no browser (ex: abrir URL) — emitida pelo loop de
          // tool-use server-side em api/chat.js.
          actions.push(ev);
          onAction?.(ev);
        } else if (ev.type === 'jarvis_tool') {
          onToolStatus?.(ev);
        } else if (ev.type === 'error') {
          // Erro sintético do loop server-side (headers já enviados quando
          // uma chamada upstream do meio do loop falha).
          streamError = ev.error?.message || 'erro no stream';
        }
      } catch (_) {}
    }
  }

  // Sem nenhum texto útil, o erro vira exceção (aciona a UI de erro do useChat);
  // com texto parcial, entrega o parcial — melhor meia resposta que nenhuma.
  if (streamError && !fullText.trim()) {
    throw new Error(`API stream: ${streamError}`);
  }

  return { text: fullText, jarvis, tokenUsage, actions };
}
