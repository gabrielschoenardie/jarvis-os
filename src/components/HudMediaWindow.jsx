import { useState, useEffect, useRef } from 'react';
import { C } from '../lib/constants.js';
import { Corners } from './hud/index.js';

// COEP require-corp (vercel.json/vite.config.js — indispensável pro VAD:
// SharedArrayBuffer/WASM threads) bloqueia iframes cross-origin sem CORP.
// O atributo `credentialless` (Chromium) contorna sem remover o header.
// Fallback (Firefox/Safari): a janela abre com link externo no lugar do player.
const supportsCredentialless =
  typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype;

export function HudMediaWindow({ media, onClose }) {
  const [closing, setClosing] = useState(false);
  // Deslocamento do arraste (a janela nasce centralizada; isto a move a partir daí).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);

  // Troca de vídeo com a janela aberta: novo conteúdo cancela um fechamento em
  // curso e recentraliza.
  useEffect(() => { setClosing(false); setOffset({ x: 0, y: 0 }); }, [media?.videoId]);

  useEffect(() => {
    if (!media) return;
    const onKey = e => { if (e.key === 'Escape') setClosing(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media]);

  // A11y de teclado: ao abrir, leva o foco pro botão de fechar; ao fechar/
  // desmontar, devolve o foco a quem abriu a janela (sem trap de foco).
  useEffect(() => {
    if (!media) return;
    restoreFocusRef.current = document.activeElement;
    closeBtnRef.current?.focus();
    return () => {
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [media?.videoId]);

  if (!media) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${media.videoId}`;
  const handleAnimEnd = e => {
    // Só o fim do hudOut desmonta — o fim do hudIn também dispara este evento
    if (closing && e.animationName === 'hudOut') onClose();
  };

  // Arraste pela barra de título. setPointerCapture mantém o pointer mesmo
  // quando ele passa sobre o iframe do player.
  const onHeaderDown = (e) => {
    if (e.target.closest('button')) return; // não arrastar ao clicar em fechar
    dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderMove = (e) => {
    if (!dragRef.current) return;
    setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onHeaderUp = (e) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      {/* Vinheta de backdrop — foco sutil na janela, sem virar modal (não
          captura clique; o HUD atrás segue interativo). */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 72% 72% at center, transparent 45%, rgba(3,7,16,0.5) 100%)' }} />

      {/* Wrapper do arraste: o translate vive aqui, separado da animação de
          entrada/saída da janela (que também usa transform). */}
      <div style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, pointerEvents: 'auto' }}>
        <div
          className={`jv-holo-glass ${closing ? 'jv-hud-out' : 'jv-hud-in'}`}
          onAnimationEnd={handleAnimEnd}
          style={{ position: 'relative', width: 'min(720px, 92vw)', boxShadow: '0 0 40px rgba(0,212,255,0.12)' }}
        >
          <Corners />

          <div
            onPointerDown={onHeaderDown}
            onPointerMove={onHeaderMove}
            onPointerUp={onHeaderUp}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${C.line}`, cursor: 'move', touchAction: 'none', userSelect: 'none' }}
          >
            <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.22em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
              ◉ HUD DISPLAY · {media.title}
            </span>
            {media.channel && (
              <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{media.channel}</span>
            )}
            <button
              ref={closeBtnRef}
              onClick={() => setClosing(true)}
              aria-label="Fechar"
              style={{
                background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent,
                fontSize: 11, lineHeight: 1, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000' }}>
            {supportsCredentialless ? (
              <iframe
                credentialless=""
                src={`https://www.youtube-nocookie.com/embed/${media.videoId}?autoplay=1&rel=0`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                title={media.title}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.14em' }}>
                  player embutido indisponível neste navegador
                </span>
                <a
                  href={watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block', fontSize: 10, color: C.accent, letterSpacing: '0.18em',
                    border: `1px solid ${C.accentDim}`, padding: '5px 12px', textDecoration: 'none',
                  }}
                >
                  ▸ ABRIR NO YOUTUBE
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
