// Helpers isomórficos (usados tanto no cliente quanto em api/chat.js) pra lidar
// com `content` de mensagem que pode ser string simples OU array de content
// blocks da Anthropic (quando há imagem/documento anexado).

export function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.find(b => b.type === 'text')?.text || '';
  return '';
}

export function replaceMessageText(content, newText) {
  if (typeof content === 'string') return newText;
  if (Array.isArray(content)) return content.map(b => b.type === 'text' ? { ...b, text: newText } : b);
  return newText;
}

export function hasImageAttachment(content) {
  return Array.isArray(content) && content.some(b => b.type === 'image' || b.type === 'document');
}

// Reduz um content array com imagem pro texto puro (já contém o marcador
// "[Anexo: nome]"). Usado pra comprimir turnos antigos antes de reenviar pra
// Anthropic (evita pagar reprocessamento de imagem em toda mensagem
// subsequente) e pra nunca gravar base64 de imagem no localStorage.
export function stripImageAttachment(content) {
  return hasImageAttachment(content) ? extractMessageText(content) : content;
}
