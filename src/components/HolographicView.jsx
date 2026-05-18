import { useState, useEffect } from 'react';
import { C, display } from '../lib/constants.js';

function HoloPanel({ children }) {
  return (
    <div className="jv-holo-glass jv-drift" style={{ padding: '16px 18px', position: 'relative', minWidth: 200 }}>
      {['tl','tr','bl','br'].map(p => {
        const s = { position: 'absolute', width: 8, height: 8 };
        const styles = {
          tl: { ...s, top:-1,left:-1,borderTop:`1px solid ${C.accent}`,borderLeft:`1px solid ${C.accent}` },
          tr: { ...s, top:-1,right:-1,borderTop:`1px solid ${C.accent}`,borderRight:`1px solid ${C.accent}` },
          bl: { ...s, bottom:-1,left:-1,borderBottom:`1px solid ${C.accent}`,borderLeft:`1px solid ${C.accent}` },
          br: { ...s, bottom:-1,right:-1,borderBottom:`1px solid ${C.accent}`,borderRight:`1px solid ${C.accent}` },
        };
        return <span key={p} style={styles[p]} />;
      })}
      {children}
    </div>
  );
}

function HoloRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 11 }}>
      <span style={{ color: C.muted, letterSpacing: '0.14em', minWidth: 88 }}>{label}</span>
      <span style={{ color: C.accent, flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export function HolographicView({ telemetry, history, thinking, speaking, listening, ready, time }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 50);
    return () => clearInterval(t);
  }, []);

  const lastMessage = [...history].reverse().find(m => m.role === 'jarvis');
  const t = tick * 0.05;
  const cx = 200, cy = 200;

  return (
    <div style={{ flex: 1, minHeight: '400px', position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 50%, rgba(0,212,255,0.05), transparent 65%)' }}>

      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="400" height="400" viewBox="0 0 400 400" style={{ overflow: 'visible' }}>
          <defs>
            <filter id="arcGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#00d4ff" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#007a99" stopOpacity="0.05" />
            </radialGradient>
            <radialGradient id="ambientGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={cx} cy={cy} r={200} fill="url(#ambientGrad)" />

          <g transform={`rotate(${t * 8}, ${cx}, ${cy})`}>
            <circle cx={cx} cy={cy} r={155} fill="none" stroke="#00d4ff" strokeWidth="1.2" opacity="0.22" strokeDasharray="12 20" />
            {[0,45,90,135,180,225,270,315].map((deg, i) => {
              const rad = (deg * Math.PI) / 180;
              return <line key={i} x1={cx + 148 * Math.cos(rad)} y1={cy + 148 * Math.sin(rad)} x2={cx + 162 * Math.cos(rad)} y2={cy + 162 * Math.sin(rad)} stroke="#00d4ff" strokeWidth="2" opacity="0.45" />;
            })}
          </g>

          <g transform={`rotate(${-t * 14}, ${cx}, ${cy})`}>
            <circle cx={cx} cy={cy} r={125} fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.32" strokeDasharray="6 14" />
            {[0,60,120,180,240,300].map((deg, i) => {
              const rad = (deg * Math.PI) / 180;
              const nx = cx + 125 * Math.cos(rad); const ny = cy + 125 * Math.sin(rad);
              return <g key={i}><circle cx={nx} cy={ny} r={5} fill="none" stroke="#00d4ff" strokeWidth="1.2" opacity="0.65" /><circle cx={nx} cy={ny} r={2} fill="#00d4ff" opacity="0.9" /></g>;
            })}
          </g>

          <g transform={`rotate(${t * 22}, ${cx}, ${cy})`}>
            <circle cx={cx} cy={cy} r={95} fill="none" stroke="#00d4ff" strokeWidth="2" opacity="0.48" strokeDasharray="3 9" />
            {[0,120,240].map((deg, i) => {
              const rad = (deg * Math.PI) / 180;
              const nx = cx + 95 * Math.cos(rad); const ny = cy + 95 * Math.sin(rad); const size = 6;
              return <polygon key={i} points={`${nx},${ny - size} ${nx - size * 0.866},${ny + size * 0.5} ${nx + size * 0.866},${ny + size * 0.5}`} fill="#00d4ff" opacity="0.75" transform={`rotate(${deg}, ${nx}, ${ny})`} />;
            })}
          </g>

          <circle cx={cx} cy={cy} r={65} fill="none" stroke="#00d4ff" strokeWidth="2.5" opacity="0.58" />
          <circle cx={cx} cy={cy} r={65} fill="none" stroke="#00d4ff" strokeWidth="8" opacity={0.06 + Math.sin(t * 1.8) * 0.04} />

          {[0,60,120,180,240,300].map((deg, i) => {
            const rad1 = ((deg - 24) * Math.PI) / 180; const rad2 = ((deg + 24) * Math.PI) / 180; const r = 48;
            const x1 = cx + r * Math.cos(rad1); const y1 = cy + r * Math.sin(rad1);
            const x2 = cx + r * Math.cos(rad2); const y2 = cy + r * Math.sin(rad2);
            return <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`} fill="#00d4ff" opacity={i % 2 === 0 ? 0.09 + Math.sin(t * 2 + i) * 0.04 : 0.04} stroke="#00d4ff" strokeWidth="0.5" />;
          })}

          <circle cx={cx} cy={cy} r={30} fill="url(#coreGrad)" filter="url(#arcGlow)" />
          <circle cx={cx} cy={cy} r={18} fill="#00d4ff" opacity={0.12 + Math.sin(t * 2.4) * 0.07} />
          <circle cx={cx} cy={cy} r={10} fill="#00d4ff" opacity="0.85" />
          <circle cx={cx} cy={cy} r={4} fill="#ffffff" opacity="0.95" />

          <text x={cx} y={cy + 95 + 24} textAnchor="middle" fill="#4a7a99" fontSize="8" letterSpacing="4" fontFamily="JetBrains Mono, monospace">
            STARK INDUSTRIES · {ready ? 'ONLINE' : 'BOOT'}
          </text>
        </svg>
      </div>

      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {[...Array(20)].map((_, i) => {
          const angle = (i / 20) * Math.PI * 2 + t * (i % 2 === 0 ? 0.12 : -0.08);
          const r = 200 + (i % 4) * 55;
          const x = 50 + (Math.cos(angle) * r / 8);
          const y = 50 + (Math.sin(angle) * r / 16);
          return <div key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: i % 3 === 0 ? 2 : 1, height: i % 3 === 0 ? 2 : 1, borderRadius: '50%', background: '#00d4ff', opacity: 0.25 + (i % 5) * 0.08 }} />;
        })}
      </div>

      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div className="jv-holo-in" style={{ position: 'absolute', top: 20, left: 28, pointerEvents: 'auto' }}>
          <div style={{ fontFamily: '"Rajdhani", sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: '0.12em', color: '#00d4ff' }}>STARK INDUSTRIES</div>
          <div style={{ fontSize: 9, color: '#4a7a99', letterSpacing: '0.32em', marginTop: 4 }}>J.A.R.V.I.S. · ARC REACTOR · MARK VII</div>
        </div>

        <div className="jv-holo-in" style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 18, fontSize: 9, letterSpacing: '0.28em', color: '#4a7a99', pointerEvents: 'auto' }}>
          {['MATRIX','ARCHIVE','SYNTHESIA'].map(l => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00d4ff' }} />
              <span>{l}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: speaking || listening ? '#00d4ff' : '#1e3a4a' }} className={speaking || listening ? 'jv-pulse' : ''} />
            <span style={{ color: speaking || listening ? '#4a7a99' : '#1e3a4a' }}>VOZ</span>
          </div>
        </div>

        <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, left: 28, pointerEvents: 'auto' }}>
          <HoloPanel>
            <div style={{ fontSize: 9, color: '#4a7a99', letterSpacing: '0.32em', marginBottom: 10 }}>TELEMETRIA · TEMPO REAL</div>
            <HoloRow label="POTÊNCIA" value={`${Math.round(telemetry.load)}%`} />
            <HoloRow label="MEMÓRIA" value={`${Math.round(telemetry.mem)}%`} />
            <HoloRow label="LATÊNCIA API" value={`${Math.round(telemetry.latency)} ms`} />
          </HoloPanel>
        </div>

        {lastMessage && (
          <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, right: 28, maxWidth: 380, pointerEvents: 'auto' }} key={history.length}>
            <HoloPanel>
              <div style={{ fontSize: 9, color: '#4a7a99', letterSpacing: '0.32em', marginBottom: 10 }}>ÚLTIMA TRANSMISSÃO</div>
              <div style={{ fontSize: 12, lineHeight: 1.65, color: '#c8e8f8', maxHeight: 150, overflowY: 'auto' }} className="jv-scrollbar">
                {lastMessage.type === 'ai'
                  ? lastMessage.text?.slice(0, 380) + (lastMessage.text?.length > 380 ? '…' : '')
                  : lastMessage.lines?.join(' ')}
              </div>
            </HoloPanel>
          </div>
        )}

        {thinking && (
          <div className="jv-holo-in" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ display: 'inline-block', padding: '14px 28px', border: '1px solid rgba(0,212,255,0.26)', background: 'rgba(5,10,20,0.75)', backdropFilter: 'blur(6px)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.32em', color: '#00d4ff' }} className="jv-pulse">PROCESSANDO · STARK DB · J.A.R.V.I.S.</div>
            </div>
          </div>
        )}

        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 45%, rgba(5,10,20,0.65) 100%)' }} />
      </div>
    </div>
  );
}
