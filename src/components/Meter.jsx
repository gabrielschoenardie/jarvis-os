import { C } from '../lib/constants.js';

// Medidor segmentado. `max` define a escala (padrão 100 = porcentagem); o
// preenchimento é sempre clampado em 0..segments — antes um valor bruto de
// tokens (ex.: 3500) estourava a conta e deixava a barra cravada em 12/12.
// `display` sobrescreve o texto do valor (ex.: contagem formatada).
export function Meter({ label, value, unit, max = 100, display }) {
  const segments = 12;
  const ratio = max > 0 ? value / max : 0;
  const filled = Math.max(0, Math.min(segments, Math.round(ratio * segments)));
  const shown = display != null ? display : `${value}${unit || ''}`;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dim, letterSpacing: '0.28em', marginBottom: 6 }}>
        <span>{label}</span><span style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{shown}</span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: segments }).map((_, i) => <span key={i} style={{ flex: 1, height: 5, background: i < filled ? C.accent : 'rgba(0,212,255,0.08)', opacity: i < filled ? (0.4 + (i / segments) * 0.6) : 1 }} />)}
      </div>
    </div>
  );
}
