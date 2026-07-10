import { C } from '../lib/constants.js';
import { ToggleBtn } from './VoiceIndicator.jsx';

export function VoicePanel({
  voiceOut, toggleVoiceOut,
  // ElevenLabs
  elVoices, selectedVoiceId, setSelectedVoiceId,
  stability, setStability, similarityBoost, setSimilarityBoost, elStyle, setElStyle,
  fallbackActive, elError,
  // Web Speech (fallback controls)
  voices, selectedVoiceURI, setSelectedVoiceURI, rate, setRate, pitch, setPitch,
  speak, voiceError, sttError, apiError,
  conversationMode, setConversationMode,
  vadLoading, recogSupported,
  apiHistoryLength, onClearHistory,
}) {
  return (
    <div className="jv-fade" style={{ position: 'relative', zIndex: 10, borderBottom: `1px solid ${C.line}`, background: 'rgba(0,212,255,0.03)', padding: '18px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <ToggleBtn label="SAÍDA" on={voiceOut} onClick={toggleVoiceOut} />
        <ToggleBtn label="CONVERSA" on={conversationMode} onClick={() => setConversationMode(v => !v)} />

        <span style={{ width: 1, alignSelf: 'stretch', minHeight: 22, background: C.line }} />

        {/* ElevenLabs voice selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>VOZ EL</span>
          <select
            className="jv-select"
            value={selectedVoiceId}
            onChange={e => setSelectedVoiceId(e.target.value)}
          >
            {elVoices.length === 0 && <option value="">carregando...</option>}
            {elVoices.map(v => (
              <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Stability */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>ESTAB.</span>
          <input type="range" min="0" max="1" step="0.05" value={stability}
            onChange={e => setStability(parseFloat(e.target.value))} className="jv-slider" style={{ width: 70 }} />
          <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{stability.toFixed(2)}</span>
        </div>

        {/* Similarity Boost */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>SIM.</span>
          <input type="range" min="0" max="1" step="0.05" value={similarityBoost}
            onChange={e => setSimilarityBoost(parseFloat(e.target.value))} className="jv-slider" style={{ width: 70 }} />
          <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{similarityBoost.toFixed(2)}</span>
        </div>

        {/* Style */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>ESTILO</span>
          <input type="range" min="0" max="1" step="0.05" value={elStyle}
            onChange={e => setElStyle(parseFloat(e.target.value))} className="jv-slider" style={{ width: 70 }} />
          <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{elStyle.toFixed(2)}</span>
        </div>

        <span style={{ width: 1, alignSelf: 'stretch', minHeight: 22, background: C.line }} />

        {/* History */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>HISTÓRICO</span>
          <span style={{ fontSize: 10, color: C.accent }}>{apiHistoryLength} turnos</span>
          <button onClick={onClearHistory} style={{ background: 'transparent', border: `1px solid ${C.dim}`, color: C.dim, padding: '3px 8px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.18em', cursor: 'pointer' }}>LIMPAR</button>
        </div>

        <button
          onClick={() => speak('Teste de voz. J.A.R.V.I.S. operacional.')}
          disabled={!voiceOut || !selectedVoiceId}
          style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent, padding: '6px 14px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: voiceOut && selectedVoiceId ? 'pointer' : 'not-allowed', opacity: voiceOut && selectedVoiceId ? 1 : 0.4 }}
        >▸ TESTAR</button>
      </div>

      {/* Fallback Web Speech controls — visible only when ElevenLabs is unavailable */}
      {fallbackActive && (
        <div className="jv-fade" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <span style={{ fontSize: 9, color: C.warn, letterSpacing: '0.22em' }}>▸ FALLBACK WEB SPEECH</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>VOZ</span>
            <select className="jv-select" value={selectedVoiceURI || ''} onChange={e => setSelectedVoiceURI(e.target.value)}>
              {voices.length === 0 && <option>nenhuma</option>}
              {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>RITMO</span>
            <input type="range" min="0.7" max="1.2" step="0.05" value={rate} onChange={e => setRate(parseFloat(e.target.value))} className="jv-slider" style={{ width: 70 }} />
            <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{rate.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>TOM</span>
            <input type="range" min="0.7" max="1.1" step="0.02" value={pitch} onChange={e => setPitch(parseFloat(e.target.value))} className="jv-slider" style={{ width: 70 }} />
            <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{pitch.toFixed(2)}</span>
          </div>
        </div>
      )}

      {recogSupported === false && (
        <div style={{ marginTop: 4, fontSize: 10, color: C.warn, letterSpacing: '0.12em' }}>⚠ voz não suportada neste navegador · requer Chromium com isolamento cross-origin</div>
      )}
      {vadLoading && !sttError && (
        <div style={{ marginTop: 4, fontSize: 9, color: C.dim, letterSpacing: '0.22em' }}>▸ INICIALIZANDO VAD...</div>
      )}
      {fallbackActive && <div style={{ marginTop: 8, fontSize: 10, color: C.warn, letterSpacing: '0.12em' }}>⚠ voz premium indisponível · usando fallback</div>}
      {elError && <div style={{ marginTop: 4, fontSize: 10, color: C.critical, letterSpacing: '0.12em' }}>⚠ EL: {elError}</div>}
      {sttError && <div style={{ marginTop: 4, fontSize: 10, color: C.warn, letterSpacing: '0.12em' }}>⚠ STT: {sttError}</div>}
      {voiceError && <div style={{ marginTop: 4, fontSize: 10, color: C.warn, letterSpacing: '0.12em' }}>⚠ {voiceError}</div>}
      {apiError && <div style={{ marginTop: 4, fontSize: 10, color: C.critical, letterSpacing: '0.12em' }}>⚠ API: {apiError}</div>}
    </div>
  );
}
