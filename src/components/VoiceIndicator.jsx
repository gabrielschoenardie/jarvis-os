import { C } from '../lib/constants.js';

export function VoiceIndicator({ voiceOut, speaking, listening, onToggle, onPanel, supported }) {
  const state = speaking ? 'speaking' : listening ? 'listening' : voiceOut ? 'on' : 'off';
  const color = state !== 'off' ? C.accent : C.muted;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button onClick={onToggle} disabled={!supported} style={{ background: 'transparent', border: 'none', cursor: supported ? 'pointer' : 'not-allowed', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', height: 12, width: 14 }}>
          {speaking ? <>{[12,12,12].map((h,i) => <span key={i} className="jv-wave-bar" style={{ height: h }} />)}</> : <><span style={{ width: 2, height: 4, background: color }} /><span style={{ width: 2, height: 8, background: color }} /><span style={{ width: 2, height: 6, background: color }} /></>}
        </span>
        <span style={{ color, fontSize: 10, letterSpacing: '0.22em' }}>{state === 'speaking' ? 'TRANSMITINDO' : state === 'listening' ? 'OUVINDO' : state === 'on' ? 'VOZ ATIVA' : 'VOZ'}</span>
      </button>
      <button onClick={onPanel} style={{ background: 'transparent', border: `1px solid ${C.line}`, color: C.muted, padding: '2px 6px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.2em', cursor: 'pointer' }}>◇</button>
    </div>
  );
}

export function ToggleBtn({ label, on, onClick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>{label}</span>
      <button onClick={onClick} style={{ background: on ? 'rgba(0,212,255,0.12)' : 'transparent', border: `1px solid ${on ? C.accent : C.line}`, color: on ? C.accent : C.muted, padding: '6px 12px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.2em', cursor: 'pointer' }}>
        {on ? '◉ ON' : '○ OFF'}
      </button>
    </div>
  );
}

export function MicButton({ listening, onStart, onStop, disabled }) {
  return (
    <button onClick={listening ? onStop : onStart} disabled={disabled} className={listening ? 'jv-ring' : ''}
      style={{ background: listening ? C.accent : 'transparent', border: `1px solid ${listening ? C.accent : (disabled ? C.dim : C.accentDim)}`, color: listening ? C.bg : (disabled ? C.dim : C.accent), width: 34, height: 34, borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', fontSize: 14, transition: 'all 0.2s' }}>
      {listening ? <span style={{ display: 'inline-flex', gap: 1.5, alignItems: 'center', height: 12 }}>{[12,12,12].map((h,i)=><span key={i} className="jv-wave-bar" style={{ height: h, background: C.bg }} />)}</span> : <span style={{ lineHeight: 1, fontSize: 13 }}>◐</span>}
    </button>
  );
}
