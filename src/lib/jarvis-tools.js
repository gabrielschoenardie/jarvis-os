// ═══════════════════════════════════════════════════════════════════════════
// JARVIS · Tools — definições + executores (Fase 4: tool-use real)
// ═══════════════════════════════════════════════════════════════════════════
//
// Módulo puro e edge-safe (sem eval/Function, sem APIs de Node) — usado por
// api/chat.js (Edge runtime) e testável isoladamente via Node.
//
// web_search é uma server tool nativa da Anthropic: a busca executa na infra
// deles e os resultados continuam no MESMO stream SSE — nenhum executor aqui.
// calcular, abrir_site e hud_display são custom tools executadas em
// executeTool() (async — hud_display valida o vídeo via oEmbed do YouTube).

export const JARVIS_TOOLS = [
  // Ordem estável (constante de módulo) — tools ficam antes de system na
  // hierarquia de prompt caching; variar o array por request mataria o cache.
  { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  {
    name: 'calcular',
    description: 'Calculadora determinística. Use para QUALQUER aritmética não-trivial (bitrates, tamanhos de arquivo, durações, conversões) em vez de calcular de cabeça. Avalia uma expressão aritmética e retorna o resultado exato.',
    input_schema: {
      type: 'object',
      properties: {
        expressao: {
          type: 'string',
          description: 'Expressão aritmética, ex: "45*60*707/8/1000". Suporta + - * / % ^ (potência), parênteses e as funções sqrt(), abs(), round(), floor(), ceil(). Vírgula decimal PT-BR aceita ("1,5") e notação científica ("1e9").',
        },
      },
      required: ['expressao'],
    },
  },
  {
    name: 'abrir_site',
    description: 'Solicita a abertura de uma página no navegador do operador (nova aba). Use quando Gabriel pedir para abrir, mostrar ou buscar algo no navegador (Google, YouTube ou uma URL https direta).',
    input_schema: {
      type: 'object',
      properties: {
        destino: {
          type: 'string',
          enum: ['google', 'youtube', 'url'],
          description: '"google" = busca no Google; "youtube" = busca no YouTube; "url" = URL https direta.',
        },
        consulta: { type: 'string', description: 'Termo de busca (obrigatório para destino google/youtube).' },
        url: { type: 'string', description: 'URL https completa (obrigatório para destino url).' },
        rotulo: { type: 'string', description: 'Rótulo curto para exibir no console do operador.' },
      },
      required: ['destino'],
    },
  },
  {
    name: 'hud_display',
    description: 'Exibe um vídeo do YouTube DENTRO da interface do operador: abre uma janela flutuante no HUD com o player embutido. Use quando Gabriel pedir para VER/assistir/mostrar um vídeo na interface. Requer a URL exata de um vídeo do YouTube — se não souber a URL, use web_search antes para encontrá-la.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL do vídeo (youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., youtube.com/embed/...) ou o ID de 11 caracteres.' },
        titulo: { type: 'string', description: 'Título do vídeo, se conhecido — usado como fallback se a validação online falhar.' },
      },
      required: ['url'],
    },
  },
];

export const TOOL_NAMES = ['web_search', 'calcular', 'abrir_site', 'hud_display'];


// ───────────────────────────────────────────────────────────────────────────
// Calculadora — tokenizer + parser recursive-descent (sem eval/Function)
// Gramática: expr → term (('+'|'-') term)*
//            term → unary (('*'|'/'|'%') unary)*
//            unary → '-' unary | power             [-3^2 = -(3^2), convenção]
//            power → primary ('^' unary)?          [assoc. à direita]
//            primary → número | '(' expr ')' | fn '(' expr ')'
// ───────────────────────────────────────────────────────────────────────────

const CALC_FUNCTIONS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

function normalizeDecimals(expr) {
  // PT-BR: "1.234,56" → "1234.56"; só vírgula ("1,5") → "1.5"
  if (/\d,\d/.test(expr) && /\d\.\d/.test(expr)) {
    return expr.replace(/(\d)\.(?=\d)/g, '$1').replace(/(\d),(?=\d)/g, '$1.');
  }
  return expr.replace(/(\d),(?=\d)/g, '$1.');
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ('+-*/%^()'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] || ''))) {
      const m = expr.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      tokens.push({ type: 'num', value: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const m = expr.slice(i).match(/^[a-zA-Z]+/);
      // Object.hasOwn evita vazar membros do prototype ("constructor", "toString")
      if (!Object.hasOwn(CALC_FUNCTIONS, m[0])) throw new Error(`função desconhecida "${m[0]}" — disponíveis: ${Object.keys(CALC_FUNCTIONS).join(', ')}`);
      tokens.push({ type: 'fn', value: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`caractere inválido "${ch}"`);
  }
  return tokens;
}

function parseTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  const expectOp = (op) => {
    const t = eat();
    if (!t || t.type !== 'op' || t.value !== op) throw new Error(`esperava "${op}"`);
  };

  function expr() {
    let v = term();
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = eat().value;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (peek()?.type === 'op' && ['*', '/', '%'].includes(peek().value)) {
      const op = eat().value;
      const r = unary();
      if ((op === '/' || op === '%') && r === 0) throw new Error('divisão por zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function unary() {
    if (peek()?.type === 'op' && peek().value === '-') { eat(); return -unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek()?.type === 'op' && peek().value === '^') {
      eat();
      return Math.pow(base, unary()); // assoc. à direita; expoente pode ser negativo
    }
    return base;
  }
  function primary() {
    const t = eat();
    if (!t) throw new Error('expressão incompleta');
    if (t.type === 'num') return t.value;
    if (t.type === 'fn') {
      expectOp('(');
      const arg = expr();
      expectOp(')');
      return CALC_FUNCTIONS[t.value](arg);
    }
    if (t.type === 'op' && t.value === '(') {
      const v = expr();
      expectOp(')');
      return v;
    }
    throw new Error(`token inesperado "${t.value}"`);
  }

  const result = expr();
  if (pos < tokens.length) throw new Error(`sobrou "${tokens[pos].value}" no fim da expressão`);
  return result;
}

function formatNumber(v) {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

export function evaluateExpression(raw) {
  try {
    if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'expressão vazia' };
    if (raw.length > 300) return { ok: false, error: 'expressão longa demais (máximo 300 caracteres)' };
    const tokens = tokenize(normalizeDecimals(raw.trim()));
    if (tokens.length === 0) return { ok: false, error: 'expressão vazia' };
    const value = parseTokens(tokens);
    if (!Number.isFinite(value)) return { ok: false, error: 'resultado não-finito (overflow ou operação inválida)' };
    return { ok: true, value, formatted: formatNumber(value) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


// ───────────────────────────────────────────────────────────────────────────
// abrir_site — validação + builders de URL
// ───────────────────────────────────────────────────────────────────────────

export function resolveOpenUrl(input = {}) {
  const { destino, consulta, url, rotulo } = input;

  if (destino === 'google' || destino === 'youtube') {
    if (!consulta || !consulta.trim()) return { ok: false, error: `destino "${destino}" exige o campo "consulta"` };
    const q = encodeURIComponent(consulta.trim());
    const finalUrl = destino === 'google'
      ? `https://www.google.com/search?q=${q}`
      : `https://www.youtube.com/results?search_query=${q}`;
    const label = rotulo?.trim() || `${destino === 'google' ? 'Google' : 'YouTube'}: ${consulta.trim()}`;
    return { ok: true, url: finalUrl, label };
  }

  if (destino === 'url') {
    if (!url || !url.trim()) return { ok: false, error: 'destino "url" exige o campo "url"' };
    let parsed;
    try { parsed = new URL(url.trim()); } catch (_) { return { ok: false, error: 'URL inválida' }; }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'apenas URLs https são permitidas' };
    if (!parsed.hostname) return { ok: false, error: 'URL sem hostname' };
    if (parsed.username || parsed.password) return { ok: false, error: 'URLs com credenciais embutidas não são permitidas' };
    return { ok: true, url: parsed.href, label: rotulo?.trim() || parsed.hostname };
  }

  return { ok: false, error: `destino inválido "${destino}" — use google, youtube ou url` };
}


// ───────────────────────────────────────────────────────────────────────────
// hud_display — extração de ID do YouTube + validação via oEmbed
// ───────────────────────────────────────────────────────────────────────────

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (YT_ID_RE.test(s)) return s; // ID cru de 11 caracteres
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (host === 'youtu.be') {
    const id = u.pathname.split('/')[1] || '';
    return YT_ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v') || '';
      return YT_ID_RE.test(id) ? id : null;
    }
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:$|[/?])/);
    return m ? m[1] : null;
  }
  return null;
}

// oEmbed público do YouTube (sem API key): confirma que o vídeo existe e é
// incorporável, e devolve título/canal canônicos. Três estados: 4xx é veredito
// definitivo (não existe / embed desabilitado); timeout/rede/5xx é "unknown" —
// segue graciosamente com o título informado pelo modelo.
export async function validateYouTubeVideo(videoId, timeoutMs = 3000) {
  const target = `https://www.youtube.com/watch?v=${videoId}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      const data = await res.json();
      return { status: 'ok', title: data.title || null, channel: data.author_name || null };
    }
    if (res.status >= 400 && res.status < 500) return { status: 'not_found' };
    return { status: 'unknown' };
  } catch (_) {
    return { status: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}


// ───────────────────────────────────────────────────────────────────────────
// Dispatcher — executa custom tools (async: hud_display faz I/O de rede;
// calcular e abrir_site são puras).
// Retorna { resultText, isError, action|null }. `action` vira um evento SSE
// sintético `jarvis_action` que o cliente executa (window.open + chip clicável,
// ou janela flutuante no HUD para hud_video).
// ───────────────────────────────────────────────────────────────────────────

export async function executeTool(name, input = {}) {
  if (name === 'calcular') {
    const r = evaluateExpression(input.expressao);
    if (!r.ok) return { resultText: `Erro no cálculo: ${r.error}`, isError: true, action: null };
    return { resultText: `Resultado: ${r.formatted} (valor bruto: ${r.value})`, isError: false, action: null };
  }

  if (name === 'abrir_site') {
    const r = resolveOpenUrl(input);
    if (!r.ok) return { resultText: `Não foi possível abrir: ${r.error}`, isError: true, action: null };
    return {
      resultText: `Solicitação de abertura enviada ao console do operador: ${r.label} (${r.url}). O navegador tentará abrir a página; se o popup for bloqueado, o operador verá um link clicável no console.`,
      isError: false,
      action: { action: 'open_url', url: r.url, label: r.label },
    };
  }

  if (name === 'hud_display') {
    const videoId = extractYouTubeId(input.url);
    if (!videoId) {
      return { resultText: 'Não foi possível exibir: URL de vídeo do YouTube inválida ou ausente — informe uma URL youtube.com/watch, youtu.be, shorts ou o ID de 11 caracteres.', isError: true, action: null };
    }
    const check = await validateYouTubeVideo(videoId);
    if (check.status === 'not_found') {
      return { resultText: 'Vídeo não encontrado ou não incorporável (validação oEmbed falhou) — busque outro vídeo do YouTube e tente novamente.', isError: true, action: null };
    }
    const title = check.title || input.titulo?.trim() || 'Vídeo do YouTube';
    const channel = check.channel || null;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    return {
      resultText: `Exibindo no HUD do operador: "${title}"${channel ? ` — canal ${channel}` : ''} (${url}). Janela flutuante aberta com player embutido; um chip para reabrir fica registrado no console.`,
      isError: false,
      action: { action: 'hud_video', videoId, url, title, channel },
    };
  }

  return { resultText: `Ferramenta desconhecida: ${name}`, isError: true, action: null };
}
