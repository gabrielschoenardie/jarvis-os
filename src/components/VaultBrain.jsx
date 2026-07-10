import { useState, useEffect, useRef, useMemo } from 'react';
import { C, display } from '../lib/constants.js';
import { createBrainScene } from '../lib/brain-scene.js';
import { pruneGraph, computeMetrics } from '../lib/vault-graph.js';
import { HoloPanel as HudHoloPanel } from './hud/index.js';

// Wrapper fino: mantém os defaults dos painéis do VAULT (drift + largura mínima)
// enquanto delega a superfície glass + cantoneiras à primitiva compartilhada.
function HoloPanel({ children }) {
  return <HudHoloPanel drift style={{ minWidth: 200 }}>{children}</HudHoloPanel>;
}

function HoloRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 11 }}>
      <span style={{ color: C.muted, letterSpacing: '0.14em', minWidth: 88 }}>{label}</span>
      <span style={{ color: C.accent, flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const holoButton = {
  background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent,
  padding: '8px 18px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: 'pointer',
};

// Nuvem procedural exibida enquanto o vault não está conectado — o modo
// nunca é um vazio preto. Determinística (sem Math.random) pra não variar
// entre renders/StrictMode.
function placeholderGraph() {
  const nodes = Array.from({ length: 120 }, (_, i) => ({
    id: 'ph:' + i, title: '', path: null, ghost: true, degree: (i * 7) % 5, words: 0, mtime: 0,
  }));
  const links = Array.from({ length: 90 }, (_, i) => ({
    source: 'ph:' + ((i * 13) % 120), target: 'ph:' + ((i * 29 + 7) % 120),
  })).filter(l => l.source !== l.target);
  return { nodes, links, ghostCount: 120 };
}

export default function VaultBrain({ vault, history, thinking, speaking, listening, ready, onAnalyzeNote }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const [selectedNote, setSelectedNote] = useState(null); // { id, title, path, degree, mtime }
  const [noteContent, setNoteContent] = useState(null); // { content } | { error }
  const [resetKey, setResetKey] = useState(0);
  const [contextLost, setContextLost] = useState(false);

  const lastMessage = [...history].reverse().find(m => m.role === 'jarvis');

  const pruned = useMemo(
    () => (vault.status === 'ready' && vault.graph ? pruneGraph(vault.graph) : null),
    [vault.graph, vault.status]
  );
  const metrics = useMemo(
    () => (vault.status === 'ready' && vault.graph ? computeMetrics(vault.graph, pruned) : null),
    [vault.graph, vault.status, pruned]
  );
  const recentNotes = useMemo(() => {
    if (!vault.graph) return [];
    return vault.graph.nodes.filter(n => !n.ghost).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  }, [vault.graph]);

  // Cena three.js — criada uma vez por grafo/reset; dispose simétrico
  // (StrictMode double-mount em dev exige isso).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createBrainScene(container, {
      onSelect: node => {
        setNoteContent(null);
        setSelectedNote(node && !node.ghost && node.path
          ? { id: node.id, title: node.title, path: node.path, degree: node.degree, mtime: node.mtime }
          : null);
      },
    });
    scene.onContextLost(() => setContextLost(true));
    sceneRef.current = scene;

    const cache = vault.layoutCacheRef.current;
    if (pruned) {
      scene.setGraph(pruned, cache.scanId === vault.scanId ? cache.positions : null);
    } else {
      scene.setGraph(placeholderGraph(), null);
    }

    return () => {
      if (pruned) {
        vault.layoutCacheRef.current = { scanId: vault.scanId, positions: scene.getPositions() };
      }
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pruned, vault.scanId, resetKey]);

  useEffect(() => {
    sceneRef.current?.setPulse({ thinking, speaking });
  }, [thinking, speaking]);

  // Preview da nota selecionada — releitura fresca sob demanda
  useEffect(() => {
    if (!selectedNote) return;
    let cancelled = false;
    vault.readNote(selectedNote.path)
      .then(({ content }) => { if (!cancelled) setNoteContent({ content }); })
      .catch(err => {
        if (cancelled) return;
        if (err.name === 'NotAllowedError') setNoteContent({ error: 'permission' });
        else if (err.name === 'NotFoundError') setNoteContent({ error: 'notfound' });
        else setNoteContent({ error: err.message || 'falha ao ler a nota' });
      });
    return () => { cancelled = true; };
  }, [selectedNote, vault]);

  const closeNote = () => {
    setSelectedNote(null);
    setNoteContent(null);
    sceneRef.current?.clearFocus();
  };

  const openNote = (node) => {
    setNoteContent(null);
    setSelectedNote({ id: node.id, title: node.title, path: node.path, degree: node.degree, mtime: node.mtime });
    sceneRef.current?.focusNode(node.id);
  };

  const statusPanel = (() => {
    if (contextLost) return (
      <>
        <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.warn, marginBottom: 14 }}>NÚCLEO GRÁFICO INTERROMPIDO</div>
        <button style={holoButton} onClick={() => { setContextLost(false); setResetKey(k => k + 1); }}>▸ REINICIAR</button>
      </>
    );
    switch (vault.status) {
      case 'unsupported': return (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.8, maxWidth: 340, letterSpacing: '0.06em' }}>
          Este navegador não suporta acesso a pastas locais (File System Access API).
          Use um navegador Chromium — Chrome ou Edge — para conectar o vault, Sir.
        </div>
      );
      case 'idle': return (
        <>
          <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.muted, marginBottom: 6 }}>NENHUM VAULT CONECTADO</div>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: '0.08em', marginBottom: 16, maxWidth: 320, lineHeight: 1.7 }}>
            As notas são lidas localmente no navegador — nada é enviado a servidor algum.
          </div>
          <button style={holoButton} onClick={vault.connectVault}>▸ CONECTAR VAULT</button>
        </>
      );
      case 'permission': return (
        <>
          <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.muted, marginBottom: 14 }}>VAULT AGUARDANDO PERMISSÃO</div>
          <button style={holoButton} onClick={vault.reconnectVault}>▸ RECONECTAR VAULT</button>
        </>
      );
      case 'scanning': return (
        <div className="jv-pulse" style={{ fontSize: 10, letterSpacing: '0.32em', color: C.accent }}>
          VARRENDO VAULT · {vault.progress.scanned} NOTAS…
        </div>
      );
      case 'error': return (
        <>
          <div style={{ fontSize: 10, letterSpacing: '0.22em', color: C.critical, marginBottom: 14, maxWidth: 340, lineHeight: 1.6 }}>⚠ {vault.error}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button style={holoButton} onClick={vault.rescanVault}>↺ TENTAR NOVAMENTE</button>
            <button style={holoButton} onClick={vault.connectVault}>▸ CONECTAR OUTRO VAULT</button>
          </div>
        </>
      );
      default: return null;
    }
  })();

  return (
    <div style={{ flex: 1, minHeight: '400px', position: 'relative', overflow: 'hidden' }}>
      {/* Canvas three.js */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Overlays HUD */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
        <div className="jv-holo-in" style={{ position: 'absolute', top: 20, left: 28 }}>
          <div style={{ ...display, fontSize: 20, fontWeight: 700, letterSpacing: '0.12em', color: C.accent }}>OBSIDIAN VAULT</div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.32em', marginTop: 4 }}>J.A.R.V.I.S. · NÚCLEO NEURAL · GRAFO</div>
        </div>

        <div className="jv-holo-in" style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 18, fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>
          {['MATRIX','ARCHIVE','SYNTHESIA'].map(l => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
              <span>{l}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: speaking || listening ? C.accent : C.dim }} className={speaking || listening ? 'jv-pulse' : ''} />
            <span style={{ color: speaking || listening ? C.muted : C.dim }}>VOZ</span>
          </div>
        </div>

        {/* Notas recentes */}
        {vault.status === 'ready' && recentNotes.length > 0 && !selectedNote && (
          <div className="jv-holo-in" style={{ position: 'absolute', top: 20, right: 28, pointerEvents: 'auto' }}>
            <HoloPanel>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.32em', marginBottom: 10 }}>NOTAS RECENTES</div>
              {recentNotes.map(n => (
                <button key={n.id} onClick={() => openNote(n)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: C.text, fontFamily: 'inherit', fontSize: 10.5, padding: '3px 0', cursor: 'pointer', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                  <span style={{ color: C.accentDim }}>▸ </span>{n.title}
                </button>
              ))}
            </HoloPanel>
          </div>
        )}

        {/* Métricas do vault */}
        {vault.status === 'ready' && metrics && (
          <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, left: 28, pointerEvents: 'auto' }}>
            <HoloPanel>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.32em', marginBottom: 10 }}>VAULT · MÉTRICAS</div>
              <HoloRow label="NOTAS" value={metrics.notes.toLocaleString('pt-BR')} />
              <HoloRow label="CONEXÕES" value={metrics.links.toLocaleString('pt-BR')} />
              <HoloRow label="ÓRFÃS" value={metrics.orphans.toLocaleString('pt-BR')} />
              {metrics.shown < metrics.total && <HoloRow label="EXIBINDO" value={`${metrics.shown} / ${metrics.total}`} />}
              {vault.truncatedScan && <div style={{ fontSize: 9, color: C.warn, marginTop: 6, letterSpacing: '0.1em' }}>⚠ scan parcial (4000 arquivos)</div>}
              <button onClick={vault.rescanVault} style={{ marginTop: 10, background: 'transparent', border: `1px solid ${C.line}`, color: C.accentDim, padding: '3px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>↺ REESCANEAR</button>
            </HoloPanel>
          </div>
        )}

        {/* Big stat central — total de palavras */}
        {vault.status === 'ready' && metrics && (
          <div className="jv-holo-in" style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
            <div style={{ ...display, fontSize: 34, fontWeight: 300, color: C.text, lineHeight: 1 }}>
              {metrics.totalWords.toLocaleString('pt-BR')}
            </div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.36em', marginTop: 4 }}>PALAVRAS NO VAULT</div>
          </div>
        )}

        {/* Última transmissão OU painel de nota */}
        {selectedNote ? (
          <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, right: 28, width: 380, maxWidth: '46%', pointerEvents: 'auto' }}>
            <HoloPanel>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.32em', marginBottom: 6 }}>NOTA · VAULT</div>
                  <div style={{ ...display, fontSize: 16, fontWeight: 600, color: C.accent, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNote.title}</div>
                  <div style={{ fontSize: 9, color: C.dim, marginTop: 3, letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNote.path}</div>
                </div>
                <button onClick={closeNote} style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accentDim, padding: '2px 8px', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 9.5, color: C.muted, letterSpacing: '0.1em', margin: '8px 0' }}>
                <span>CONEXÕES · {selectedNote.degree}</span>
                <span>{new Date(selectedNote.mtime).toLocaleDateString('pt-BR')}</span>
              </div>
              <div className="jv-scrollbar" style={{ fontSize: 11, lineHeight: 1.65, color: C.text, maxHeight: 140, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {noteContent === null && <span className="jv-pulse" style={{ color: C.muted }}>lendo nota…</span>}
                {noteContent?.error === 'permission' && (
                  <span style={{ color: C.warn }}>permissão revogada · <button onClick={vault.reconnectVault} style={{ ...holoButton, padding: '2px 8px', fontSize: 9 }}>RECONECTAR</button></span>
                )}
                {noteContent?.error === 'notfound' && (
                  <span style={{ color: C.warn }}>arquivo não encontrado · <button onClick={vault.rescanVault} style={{ ...holoButton, padding: '2px 8px', fontSize: 9 }}>REESCANEAR</button></span>
                )}
                {noteContent?.error && noteContent.error !== 'permission' && noteContent.error !== 'notfound' && (
                  <span style={{ color: C.warn }}>⚠ {noteContent.error}</span>
                )}
                {noteContent?.content != null && (noteContent.content.slice(0, 1000) + (noteContent.content.length > 1000 ? '…' : ''))}
              </div>
              <button
                disabled={thinking || !ready || noteContent?.content == null}
                onClick={() => onAnalyzeNote?.({ title: selectedNote.title, path: selectedNote.path, content: noteContent.content })}
                style={{ ...holoButton, marginTop: 12, width: '100%', opacity: thinking || !ready || noteContent?.content == null ? 0.4 : 1, cursor: thinking || !ready || noteContent?.content == null ? 'not-allowed' : 'pointer' }}>
                ▸ ANALISAR COM JARVIS
              </button>
            </HoloPanel>
          </div>
        ) : lastMessage && (
          <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, right: 28, maxWidth: 380, pointerEvents: 'auto' }} key={history.length}>
            <HoloPanel>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.32em', marginBottom: 10 }}>ÚLTIMA TRANSMISSÃO</div>
              <div style={{ fontSize: 12, lineHeight: 1.65, color: C.text, maxHeight: 150, overflowY: 'auto' }} className="jv-scrollbar">
                {lastMessage.type === 'ai'
                  ? lastMessage.text?.slice(0, 380) + (lastMessage.text?.length > 380 ? '…' : '')
                  : lastMessage.lines?.join(' ')}
              </div>
            </HoloPanel>
          </div>
        )}

        {/* Estado do vault (conectar/scan/erro) */}
        {statusPanel && (
          <div className="jv-holo-in" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'auto' }}>
            <div style={{ display: 'inline-block', padding: '22px 34px', border: `1px solid ${C.lineStrong}`, background: 'rgba(5,10,20,0.78)', backdropFilter: 'blur(6px)' }}>
              {statusPanel}
            </div>
          </div>
        )}

        {/* Overlay de processamento */}
        {thinking && !statusPanel && (
          <div className="jv-holo-in" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', padding: '14px 28px', border: `1px solid ${C.lineStrong}`, background: 'rgba(5,10,20,0.75)', backdropFilter: 'blur(6px)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.accent }} className="jv-pulse">PROCESSANDO · VAULT NEURAL · J.A.R.V.I.S.</div>
            </div>
          </div>
        )}

        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 45%, rgba(5,10,20,0.65) 100%)' }} />
      </div>
    </div>
  );
}
