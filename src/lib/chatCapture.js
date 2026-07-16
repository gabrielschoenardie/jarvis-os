// Constrói o Markdown de captura bruta de uma conversa, no formato que o
// vault jarvis-os-vault espera em 00-Inbox/ (ver Principle — Knowledge
// Lifecycle: Capture é o primeiro estágio do pipeline, ainda sem domain,
// hub ou aliases atribuídos — isso fica para o triage manual do operador).

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(d) {
  return `${formatDate(d)} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Notas em 00-Inbox/ ainda não passaram pelo triage humano — qualquer `[[`/`]]`
// literal digitado na conversa é escapado para não virar link (e possível nó
// fantasma) no grafo do Vault Brain antes da hora.
function escapeWikilinks(text) {
  return text.replace(/\[\[/g, '\\[\\[').replace(/\]\]/g, '\\]\\]');
}

function extractTurnText(turn) {
  if (typeof turn.content === 'string') return turn.content.trim();
  if (typeof turn.text === 'string') return turn.text.trim();
  if (Array.isArray(turn.lines)) return turn.lines.join('\n').trim();
  return '';
}

export function buildCaptureFilename(startedAt) {
  return `Capture ${formatDateTime(startedAt)}.md`;
}

export function buildCaptureMarkdown({ startedAt, turns }) {
  const today = formatDate(new Date());
  const frontmatter = [
    '---',
    'type: atomic',
    'status: seed',
    'domain:',
    `created: ${today}`,
    `updated: ${today}`,
    'importance: low',
    'aliases: []',
    '---',
  ].join('\n');

  const heading = `# Jarvis Chat — ${formatDateTime(startedAt)}`;

  const body = turns
    .filter(t => t.role === 'operator' || t.role === 'jarvis')
    .map(t => {
      const text = extractTurnText(t);
      if (!text) return null;
      const who = t.role === 'operator' ? 'Operador' : 'Jarvis';
      return `**${who}:** ${escapeWikilinks(text)}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return `${frontmatter}\n\n${heading}\n\n${body}\n`;
}
