export const C = {
  bg: '#050a14',
  line: 'rgba(0,212,255,0.10)',
  lineStrong: 'rgba(0,212,255,0.26)',
  text: '#c8e8f8',
  muted: '#4a7a99',
  dim: '#1e3a4a',
  accent: '#00d4ff',
  accentDim: '#007a99',
  critical: '#ff3c3c',
  warn: '#ffaa00',
  ok: '#00ff9d',
};

export const display = { fontFamily: '"Rajdhani", sans-serif' };
export const mono = { fontFamily: '"JetBrains Mono", ui-monospace, monospace' };

// ── Design tokens (Fase 1) ─────────────────────────────────────────────────
// Aditivos e retrocompatíveis. Os valores abaixo espelham exatamente os que
// já estavam hard-coded pelo app — introduzi-los não muda nada visualmente,
// só dá um vocabulário único pras próximas fases.

// Camadas de profundidade (z-index). Ordem: efeitos de fundo < estrutura <
// overlays na estrutura < janelas flutuantes.
export const z = {
  gridBg: 1,
  dataStream: 2,
  vaultOverlay: 3,
  grain: 4,
  scanline: 5,
  base: 10,
  overlay: 20,
  modal: 50,
};

// Movimento — durações e curvas compartilhadas (usadas pela Fase 3 em diante).
export const motion = {
  fast: '150ms',
  base: '300ms',
  slow: '450ms',
  ease: 'cubic-bezier(0.4, 0, 0.2, 1)',      // padrão
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',  // entradas
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',      // saídas
};

// Espaçamento base (px).
export const space = { xs: 4, sm: 8, md: 14, lg: 22, xl: 32 };

// Raios — a estética FUI é reta; só círculos e a caixa de erro fogem disso.
export const radius = { none: 0, sm: 2, box: 4, pill: '50%' };

// Superfície "holográfica" (glass) — mesmos valores da classe .jv-holo-glass,
// exposta como objeto pra consumo em JS/inline.
export const glass = {
  background: 'rgba(5,10,20,0.55)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  border: `1px solid rgba(0,212,255,0.18)`,
};

// Presets de tipografia (spreadable). Hierarquia por tracking, como o app já faz.
export const type = {
  eyebrow: { fontSize: 10, letterSpacing: '0.32em', textTransform: 'uppercase' },
  micro: { fontSize: 9, letterSpacing: '0.28em' },
  label: { fontSize: 11, letterSpacing: '0.22em' },
};

// Modelo Claude — fonte única de verdade pros rótulos exibidos na UI.
// (O id real do runtime vive em resolveCommandConfig; aqui é só apresentação.)
export const MODEL = { id: 'claude-sonnet-4-6', label: 'sonnet-4.6', core: '4.6' };

// Clampa um valor em 0–100 e arredonda — pra medidores de porcentagem.
export const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v || 0)));
