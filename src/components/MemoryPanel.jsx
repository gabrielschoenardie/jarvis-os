import { useEffect, useRef } from 'react';
import { C, mono, z } from '../lib/constants.js';
import { HoloPanel } from './hud/index.js';

// Inspetor de memória (Etapa 6, só leitura) — a cinta mostra "MEMÓRIA: N"
// desde a Etapa 4. Isto expõe exatamente as notas que entraram no último
// prompt, o custo estimado em tokens, e — desde a Fase A
// (docs/HYBRID_MEMORY_PLAN.md) — o score de relevância quando a origem foi
// busca semântica (`detail.mode === 'semantic'`; ausente/undefined no
// fallback de recência). `detail` vem de vault.memoryDetail
// (src/lib/memoryContext.js:buildMemoryDetail), calculado pela mesma função
// que monta o texto efetivamente enviado — a lista aqui nunca diverge do que
// foi pro modelo. Nada aqui muda o que é enviado; fixar/excluir uma nota do
// contexto é um passo futuro, não este.
export function MemoryPanel({ detail, onClose }) {
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    restoreFocusRef.current = document.activeElement;
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [onClose]);

  const { notes, totalChars, totalTokens, mode } = detail;
  const footerLabel = mode === 'semantic' ? 'busca semântica + recência' : 'recência pura, sem busca';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: z.overlay, pointerEvents: 'none' }}>
      {/* Clique fora fecha — não é modal: o HUD atrás segue interativo. */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} />

      <div className="jv-fade" style={{ position: 'absolute', top: 88, left: 28, pointerEvents: 'auto' }}>
        <HoloPanel style={{ width: 'min(420px, 88vw)', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 0 40px rgba(0,212,255,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.22em', flex: 1 }}>◉ MEMÓRIA · NO PROMPT AGORA</span>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Fechar"
              style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, fontSize: 11, lineHeight: 1, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
            >✕</button>
          </div>

          {notes.length === 0 ? (
            <div style={{ fontSize: 11, color: C.quiet, letterSpacing: '0.06em' }}>nenhuma nota recente do vault entrou no contexto.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => {
                const headingLabel = n.headingPath || n.heading || null;
                const chunkLabel = (n.chunkIndex != null && n.chunkCount != null)
                  ? `chunk ${n.chunkIndex + 1}/${n.chunkCount}`
                  : null;
                return (
                  <div key={n.path || n.title} style={{ borderLeft: `2px solid ${C.line}`, paddingLeft: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: C.text }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                      <span style={{ ...mono, color: C.quiet, whiteSpace: 'nowrap' }}>
                        ≈{n.tokens} tok{n.score != null ? ` · ${n.score.toFixed(2)}` : ''}{chunkLabel ? ` · ${chunkLabel}` : ''}
                      </span>
                    </div>
                    {headingLabel && (
                      <div
                        title={headingLabel}
                        style={{ fontSize: 10, color: C.quiet, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {headingLabel}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
                      {n.excerpt.length > 140 ? n.excerpt.slice(0, 140) + '…' : n.excerpt}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, letterSpacing: '0.08em' }}>
            <span>{notes.length} nota{notes.length === 1 ? '' : 's'} · {footerLabel}</span>
            <span style={{ ...mono, color: C.quiet }}>≈{totalTokens} tok · {totalChars}/2000 car.</span>
          </div>
        </HoloPanel>
      </div>
    </div>
  );
}
