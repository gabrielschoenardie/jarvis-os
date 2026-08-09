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
// voz ouvindo/falando, foco em curso, índice semântico construindo).
// Contadores puros (memória, contexto, latência) ficam sempre quiet — são
// números, não um liga/desliga.

// onClick é opcional — só o item MEMÓRIA (Etapa 6) o usa hoje, pra abrir o
// inspetor. Os demais continuam puramente informativos.
function Item({ label, value, active, className, onClick }) {
  const interactive = typeof onClick === 'function';
  return (
    <span
      className={className}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }) : undefined}
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap', cursor: interactive ? 'pointer' : 'default' }}
    >
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

export function StatusStrip({ vault, memoryNoteCount, onOpenMemory, focusMode, speech, contextPct, subscribeLatency, getLatency, indexStatus, indexProgress }) {
  const noteCount = vault.graph ? vault.graph.nodes.filter(n => !n.ghost).length : 0;
  const vaultActive = vault.status === 'ready' || vault.status === 'scanning';
  const vaultValue = vault.status === 'ready' ? `${noteCount.toLocaleString('pt-BR')} notas`
    : vault.status === 'scanning' ? 'varrendo…'
    : 'desconectado';

  const voiceName = speech.elVoices?.find(v => v.voice_id === speech.selectedVoiceId)?.name;
  // Falando já tem o banner (App.jsx) com TRANSMITINDO + SILENCIAR — mais
  // proeminente e com ação real, diferente da cinta que é só leitura.
  // Contando o header (VoiceIndicator) e o Presence Core, virar ciano aqui
  // também é o 4º sinal repetindo o mesmo fato — achado P1 · redundância da
  // auditoria de HUD. A cinta acende só pra ouvindo, que não tem banner.
  const voiceActive = speech.listening;
  const voiceValue = voiceName ? `EL · ${voiceName}` : (speech.voiceOut ? 'ativa' : 'muda');

  // Fase A: ÍNDICE só aparece enquanto constrói (carregando modelo ou
  // embutindo notas) — some quando pronto, mesma regra de sinal-ativo-agora
  // que os demais itens. Não aparece se nunca indexou (idle) nem quando
  // indisponível (unavailable) — nesses casos o fallback de recência já
  // cobre silenciosamente, sem precisar de sinal na cinta.
  const indexing = indexStatus === 'loading-model' || indexStatus === 'indexing';
  const indexValue = indexStatus === 'loading-model' ? 'carregando modelo…' : `${indexProgress.done}/${indexProgress.total}`;

  // Ordem prioriza os 4 itens que precisam sobreviver a 375px sem depender de
  // scroll horizontal (vault, contexto, modelo, latência — o critério de
  // pronto da Etapa 4); foco/memória/índice/voz vêm depois, ainda alcançáveis
  // via overflow-x na cinta, mas não competem pelos primeiros pixels visíveis.
  return (
    <div className="jv-strip" style={{ borderBottom: `1px solid ${C.line}`, background: 'rgba(5,10,20,0.92)', padding: '0 28px', height: 28, display: 'flex', alignItems: 'center', gap: 20, fontSize: 10, letterSpacing: '0.1em', overflowX: 'auto' }}>
      <Item label="VAULT" value={vaultValue} active={vaultActive} />
      <Item label="CTX" value={`${contextPct}%`} />
      <Item label="MODELO" value={MODEL.label} />
      <StripLatency subscribe={subscribeLatency} getInitial={getLatency} />
      {focusMode && <Item label="◆ FOCO" value={focusMode.toUpperCase()} active />}
      {memoryNoteCount > 0 && <Item label="MEMÓRIA" value={memoryNoteCount} onClick={onOpenMemory} />}
      {indexing && <Item label="ÍNDICE" value={indexValue} active />}
      {speech.speechSupported && <Item label="VOZ" value={voiceValue} active={voiceActive} className="jv-hide-sm" />}
    </div>
  );
}
