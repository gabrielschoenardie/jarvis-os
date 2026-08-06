import { C } from '../lib/constants.js';

// Medidor segmentado. `max` define a escala (padrão 100 = porcentagem); o
// preenchimento é sempre clampado em 0..segments — antes um valor bruto de
// tokens (ex.: 3500) estourava a conta e deixava a barra cravada em 12/12.
// `display` sobrescreve o texto do valor (ex.: contagem formatada).
//
// `continuous`: quando `max` é um teto sem correspondência real (ex.: não
// existe orçamento real de 100k tokens por sessão — é só uma escala visual),
// os 12 segmentos nítidos fingem uma precisão que não existe. Nesse modo o
// medidor vira um traço contínuo (sem marcações discretas) e prefixa o
// valor com "≈" — a mesma informação, sem alegar exatidão que não tem.
// Use o modo segmentado (padrão) só quando `max` for uma fração real (ex.:
// CONTEXTO IA = turnos/20, onde 20 é o teto de truncamento de verdade).
export function Meter({ label, value, unit, max = 100, display, continuous = false }) {
  const segments = 12;
  const ratio = max > 0 ? value / max : 0;
  const filled = Math.max(0, Math.min(segments, Math.round(ratio * segments)));
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const shown = display != null ? display : `${value}${unit || ''}`;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.quiet, letterSpacing: '0.28em', marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{continuous ? `≈ ${shown}` : shown}</span>
      </div>
      {continuous ? (
        <div style={{ height: 5, background: 'rgba(0,212,255,0.08)', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${C.accentDim}, ${C.accent})` }} />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 2 }}>
          {Array.from({ length: segments }).map((_, i) => <span key={i} style={{ flex: 1, height: 5, background: i < filled ? C.accent : 'rgba(0,212,255,0.08)', opacity: i < filled ? (0.4 + (i / segments) * 0.6) : 1 }} />)}
        </div>
      )}
    </div>
  );
}
