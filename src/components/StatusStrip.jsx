import { useState, useEffect } from 'react';
import { C, MODEL, mono } from '../lib/constants.js';

// Cinta de estado (Etapa 4) — faixa persistente de 28px sob o header, só com
// sinal real e persistente: vault, memória em contexto, voz, contexto,
// modelo, latência. Resolve de uma vez: mata a fila de banners persistentes
// (memória e foco viram itens daqui, não notificação permanente), dá aos
// rails permissão de serem cenário nas telas largas, e é o único instrumento
// que sobrevive abaixo de 900px — vive fora de `.jv-rail-left`.
//
// Regra de leitura: em repouso a cinta inteira é quiet. Um item só ganha
// ciano quando reflete um estado ativo agora (vault conectado/escaneando,
// voz ouvindo/falando, foco em curso). Contadores puros (memória, contexto,
// latência) ficam sempre quiet — são números, não um liga/desliga.

function Item({ label, value, active, className }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
      <span style={{ color: active ? C.accent : C.muted }}>{label}</span>
      <span style={{ ...mono, color: active ? C.accent : C.quiet, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

// Isolado como leaf subscriber (mesmo padrão de LatencyReadout em App.jsx) —
// o tick de 100ms durante uma requisição não pode re-renderizar a cinta
// inteira, muito menos o App.
function StripLatency({ subscribe, getInitial }) {
  const [ms, setMs] = useState(() => getInitial());
  useEffect(() => subscribe(setMs), [subscribe]);
  return <Item label="LAT" value={`${Math.round(ms)}ms`} />;
}

export function StatusStrip({ vault, memoryNoteCount, focusMode, speech, contextPct, subscribeLatency, getLatency }) {
  const noteCount = vault.graph ? vault.graph.nodes.filter(n => !n.ghost).length : 0;
  const vaultActive = vault.status === 'ready' || vault.status === 'scanning';
  const vaultValue = vault.status === 'ready' ? `${noteCount.toLocaleString('pt-BR')} notas`
    : vault.status === 'scanning' ? 'varrendo…'
    : 'desconectado';

  const voiceName = speech.elVoices?.find(v => v.voice_id === speech.selectedVoiceId)?.name;
  const voiceActive = speech.speaking || speech.listening;
  const voiceValue = voiceName ? `EL · ${voiceName}` : (speech.voiceOut ? 'ativa' : 'muda');

  // Ordem prioriza os 4 itens que precisam sobreviver a 375px sem depender de
  // scroll horizontal (vault, contexto, modelo, latência — o critério de
  // pronto da Etapa 4); foco/memória/voz vêm depois, ainda alcançáveis via
  // overflow-x na cinta, mas não competem pelos primeiros pixels visíveis.
  return (
    <div className="jv-strip" style={{ borderBottom: `1px solid ${C.line}`, background: 'rgba(5,10,20,0.92)', padding: '0 28px', height: 28, display: 'flex', alignItems: 'center', gap: 20, fontSize: 10, letterSpacing: '0.1em', overflowX: 'auto' }}>
      <Item label="VAULT" value={vaultValue} active={vaultActive} />
      <Item label="CTX" value={`${contextPct}%`} />
      <Item label="MODELO" value={MODEL.label} />
      <StripLatency subscribe={subscribeLatency} getInitial={getLatency} />
      {focusMode && <Item label="◆ FOCO" value={focusMode.toUpperCase()} active />}
      {memoryNoteCount > 0 && <Item label="MEMÓRIA" value={memoryNoteCount} />}
      {speech.speechSupported && <Item label="VOZ" value={voiceValue} active={voiceActive} className="jv-hide-sm" />}
    </div>
  );
}
