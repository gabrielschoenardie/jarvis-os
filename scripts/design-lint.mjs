#!/usr/bin/env node
// Lint de design do HUD — verificação headless das regras da auditoria de
// 29/07/2026 (ver docs/HUD_AUDIT_PLAN.md). Cada etapa liga suas regras aqui
// conforme o código passa a cumpri-las; regras ainda não fechadas rodam em
// modo informativo (não derrubam o script) até a etapa que as fecha.
//
// Uso: node scripts/design-lint.mjs   (ou: npm run lint:design)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C } from '../src/lib/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// ── Coleta de arquivos ───────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(p) === '.jsx' || extname(p) === '.js') out.push(p);
  }
  return out;
}

// `rel` sempre com barra normal, inclusive no Windows — as regras comparam
// sufixo de caminho (ver Regra 5), então o separador nativo faria a isenção
// falhar só num SO.
const files = walk(SRC).map(p => ({ path: p, rel: p.slice(ROOT.length).replace(/\\/g, '/'), lines: readFileSync(p, 'utf8').split('\n') }));

// ── Contraste WCAG 2.1 ───────────────────────────────────────────────────

function luminance(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
  const f = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Regra 1 · Zero C.dim como texto ──────────────────────────────────────
// `color:`/`fill=`/`fill:` são as props que renderizam texto/glifo; border e
// background continuam livres para usar C.dim (é o papel dele: hairline e
// ponto inativo). Ternários simples (`a ? b : c`) ficam contidos no valor
// porque só cortamos em vírgula/chave — não atravessam pra próxima prop.
//
// Cobre duas formas: o token `C.dim` em JS/JSX, E o hex bruto de C.dim (ex.:
// dentro de blocos <style>{`...`}</style> embutidos, que são só uma grande
// string JS — um `.jv-input::placeholder { color: #1e3a4a; }` passa batido
// pelo primeiro regex porque não referencia `C.dim` como token. Foi
// exatamente esse buraco que deixou o placeholder do input (citado no
// achado original da auditoria) sem ser pego na Etapa 1.
function ruleNoTextDim() {
  const violations = [];
  const reToken = /\b(color|fill)\s*[:=]\s*\{?[^,}]*\bC\.dim\b/g;
  const reHex = new RegExp(`\\b(color|fill)\\s*:\\s*${C.dim}\\b`, 'gi');
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (reToken.test(line) || reHex.test(line)) violations.push(`${f.rel}:${i + 1}`);
      reToken.lastIndex = 0;
      reHex.lastIndex = 0;
    });
  }
  return violations;
}

// ── Regra 2 · Piso tipográfico (10px) ────────────────────────────────────
// `fontSize: N` (sintaxe de objeto/inline style) tem piso 10. `fontSize="N"`
// (atributo JSX literal) só aparece em <text> de SVG neste código — é a
// allowlist natural para rótulos de eixo de gráfico, sem lista hardcoded.
function ruleTypeFloor() {
  const violations = [];
  const re = /fontSize:\s*([0-9]+(?:\.[0-9]+)?)\b/g;
  for (const f of files) {
    f.lines.forEach((line, i) => {
      let m;
      while ((m = re.exec(line))) {
        if (parseFloat(m[1]) < 10) violations.push(`${f.rel}:${i + 1} (${m[1]}px)`);
      }
      re.lastIndex = 0;
    });
  }
  return violations;
}

// ── Regra 3 · Rampa de contraste ─────────────────────────────────────────
// Pisos WCAG 2.1 sobre C.bg. `text`/`muted`/`accent` são texto de leitura
// primária → ≥4.5:1. `accentDim` é elemento de interface (borda/ação
// secundária) → ≥3:1. `quiet` é o degrau deliberadamente mais baixo da
// rampa — "texto silencioso" para informação terciária (path de nota,
// contadores, hints) — a auditoria o projetou em ~4,3:1, acima do piso de
// UI (3:1) mas abaixo do piso de leitura primária (4.5:1); tratá-lo como
// leitura primária derrubaria o próprio design que a auditoria pediu.
// `dim` fica de fora — nunca deve carregar texto (Regra 1 garante isso).
const TEXT_TOKENS = ['text', 'muted', 'accent'];
const UI_TOKENS = ['accentDim', 'quiet'];

function ruleContrastRamp() {
  const violations = [];
  for (const name of TEXT_TOKENS) {
    const r = contrast(C[name], C.bg);
    if (r < 4.5) violations.push(`C.${name} (${C[name]}) = ${r.toFixed(2)}:1, abaixo do piso de texto 4.5:1`);
  }
  for (const name of UI_TOKENS) {
    const r = contrast(C[name], C.bg);
    if (r < 3) violations.push(`C.${name} (${C[name]}) = ${r.toFixed(2)}:1, abaixo do piso de UI 3:1`);
  }
  return violations;
}

// ── Regra 4 · Orçamento de pulso ──────────────────────────────────────────
// Não é "zero jv-pulse" — spinners de carregamento (VaultBrain escaneando,
// lendo nota, TerminalView pensando) são sinal real (só existem enquanto o
// estado assíncrono dura) e devem continuar pulsando. O que a auditoria
// mira é o PONTO DE STATUS (dot redondo, `borderRadius: '50%'`) que pulsa
// de forma incondicional — `className="jv-pulse"` literal na mesma linha,
// sem ternário amarrando o pulso a um estado real. Isso é precisamente o
// padrão das sentinelas (fecha na Etapa 2); o VAULT e o núcleo continuam
// pulsando, mas via className={cond ? 'jv-pulse' : ''}, não capturado aqui.
function rulePulseBudget() {
  const hits = [];
  const re = /borderRadius:\s*'50%'.*className="jv-pulse"|className="jv-pulse".*borderRadius:\s*'50%'/;
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${f.rel}:${i + 1}`);
    });
  }
  return hits;
}

// ── Regra 5 · Disciplina de blur ─────────────────────────────────────────
// backdropFilter/backdrop-filter (a propriedade de profundidade — turva o
// que está atrás) só é legítimo em superfície com cantoneira. `filter:
// blur(...)` dentro de @keyframes é outra coisa — motion blur de transição
// de entrada/saída, não tem nada a ver com a regra de profundidade — por
// isso o regex mira especificamente a propriedade backdrop, não `filter:`.
//
// Duas construções já SÃO a superfície projetada sancionada (o token
// `glass` de constants.js e a classe `.jv-holo-glass`, usados por
// HoloPanel/HudMediaWindow/WeatherCard/o cockpit do comando) — por
// convenção deste código, ambas sempre vêm com <Corners /> por perto, então
// ficam isentas aqui. Blur hand-rolled (sem o token) também passa se
// `<Corners />` aparece na mesma linha ou na seguinte — o padrão usado nos
// painéis flutuantes do VaultBrain/ErrorBoundary. Sem nenhum dos dois, é
// blur ad-hoc sem cantoneira: precisa ganhar uma ou virar estrutura opaca.
function ruleBlurDiscipline() {
  const hits = [];
  const re = /backdrop-?[Ff]ilter\s*:/;
  for (const f of files) {
    if (f.rel.endsWith('/lib/constants.js')) continue; // fonte do token glass
    f.lines.forEach((line, i) => {
      if (!re.test(line)) return;
      if (line.includes('jv-holo-glass') || line.includes('...glass')) return;
      const next = f.lines[i + 1] || '';
      if (line.includes('<Corners') || next.includes('<Corners')) return;
      hits.push(`${f.rel}:${i + 1}`);
    });
  }
  return hits;
}

// ── Runner ────────────────────────────────────────────────────────────────

let failed = false;

function report(title, violations, { enforced = true } = {}) {
  const status = violations.length === 0 ? '✓' : enforced ? '✗' : '○';
  console.log(`${status} ${title} — ${violations.length} ocorrência(s)${enforced ? '' : ' (informativo)'}`);
  if (violations.length) {
    for (const v of violations.slice(0, 20)) console.log(`    ${v}`);
    if (violations.length > 20) console.log(`    … e mais ${violations.length - 20}`);
  }
  if (enforced && violations.length > 0) failed = true;
}

console.log('── design-lint · auditoria de HUD (docs/HUD_AUDIT_PLAN.md) ──\n');
report('Regra 1 · C.dim nunca é texto', ruleNoTextDim());
report('Regra 2 · piso tipográfico 10px (SVG de dados isento)', ruleTypeFloor());
report('Regra 3 · rampa de contraste WCAG 2.1', ruleContrastRamp());
report('Regra 4 · orçamento de pulso · dot de status incondicional', rulePulseBudget());
report('Regra 5 · disciplina de blur', ruleBlurDiscipline());

console.log(failed ? '\n✗ design-lint falhou.' : '\n✓ design-lint passou.');
process.exit(failed ? 1 : 0);
