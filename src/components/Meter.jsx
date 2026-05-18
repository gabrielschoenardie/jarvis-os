import { C } from '../lib/constants.js';

export function Meter({ label, value, unit }) {
  const segments = 12, filled = Math.round((value / 100) * segments);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dim, letterSpacing: '0.28em', marginBottom: 6 }}>
        <span>{label}</span><span style={{ color: C.accent }}>{value}{unit}</span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: segments }).map((_, i) => <span key={i} style={{ flex: 1, height: 5, background: i < filled ? C.accent : 'rgba(0,212,255,0.08)', opacity: i < filled ? (0.4 + (i / segments) * 0.6) : 1 }} />)}
      </div>
    </div>
  );
}
