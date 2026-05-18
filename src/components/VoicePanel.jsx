import { C } from '../lib/constants.js';
import { ToggleBtn } from './VoiceIndicator.jsx';

export function VoicePanel({
  voiceOut, toggleVoiceOut,
  voices, selectedVoiceURI, setSelectedVoiceURI,
  rate, setRate, pitch, setPitch,
  speak, voiceError, apiError,
  apiHistoryLength, onClearHistory,
}) {
  return (
    <div className="jv-fade" style={{ position: 'relative', zIndex: 10, borderBottom: `1px solid ${C.line}`, background: 'rgba(0,212,255,0.03)', padding: '18px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
        <ToggleBtn label="SAÍDA" on={voiceOut} onClick={toggleVoiceOut} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>VOZ</span>
          <select className="jv-select" value={selectedVoiceURI || ''} onChange={e => setSelectedVoiceURI(e.target.value)}>
            {voices.length === 0 && <option>nenhuma</option>}
            {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>RITMO</span>
          <input type="range" min="0.7" max="1.2" step="0.05" value={rate} onChange={e => setRate(parseFloat(e.target.value))} className="jv-slider" style={{ width: 80 }} />
          <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{rate.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>TOM</span>
          <input type="range" min="0.7" max="1.1" step="0.02" value={pitch} onChange={e => setPitch(parseFloat(e.target.value))} className="jv-slider" style={{ width: 80 }} />
          <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{pitch.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>HISTÓRICO</span>
          <span style={{ fontSize: 10, color: C.accent }}>{apiHistoryLength} turnos</span>
          <button onClick={onClearHistory} style={{ background: 'transparent', border: `1px solid ${C.dim}`, color: C.dim, padding: '3px 8px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.18em', cursor: 'pointer' }}>LIMPAR</button>
        </div>
        <button onClick={() => speak('Teste de voz. J.A.R.V.I.S. operacional.')} disabled={!voiceOut || !selectedVoiceURI} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent, padding: '6px 14px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: voiceOut && selectedVoiceURI ? 'pointer' : 'not-allowed', opacity: voiceOut && selectedVoiceURI ? 1 : 0.4 }}>▸ TESTAR</button>
      </div>
      {voiceError && <div style={{ marginTop: 10, fontSize: 10, color: C.warn, letterSpacing: '0.12em' }}>⚠ {voiceError}</div>}
      {apiError && <div style={{ marginTop: 10, fontSize: 10, color: C.critical, letterSpacing: '0.12em' }}>⚠ API: {apiError}</div>}
    </div>
  );
}
