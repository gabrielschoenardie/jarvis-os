import { useState, useEffect } from 'react';
import { C } from '../lib/constants.js';

// COEP require-corp (vercel.json/vite.config.js — indispensável pro VAD:
// SharedArrayBuffer/WASM threads) bloqueia iframes cross-origin sem CORP.
// O atributo `credentialless` (Chromium) contorna sem remover o header.
// Fallback (Firefox/Safari): a janela abre com link externo no lugar do player.
const supportsCredentialless =
  typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype;

const CORNERS = {
  tl: { top: -1, left: -1, borderTop: `1px solid ${C.accent}`, borderLeft: `1px solid ${C.accent}` },
  tr: { top: -1, right: -1, borderTop: `1px solid ${C.accent}`, borderRight: `1px solid ${C.accent}` },
  bl: { bottom: -1, left: -1, borderBottom: `1px solid ${C.accent}`, borderLeft: `1px solid ${C.accent}` },
  br: { bottom: -1, right: -1, borderBottom: `1px solid ${C.accent}`, borderRight: `1px solid ${C.accent}` },
};

export function HudMediaWindow({ media, onClose }) {
  const [closing, setClosing] = useState(false);

  // Troca de vídeo com a janela aberta: novo conteúdo cancela um fechamento em curso
  useEffect(() => { setClosing(false); }, [media?.videoId]);

  useEffect(() => {
    if (!media) return;
    const onKey = e => { if (e.key === 'Escape') setClosing(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media]);

  if (!media) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${media.videoId}`;
  const handleAnimEnd = e => {
    // Só o fim do hudOut desmonta — o fim do hudIn também dispara este evento
    if (closing && e.animationName === 'hudOut') onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className={`jv-holo-glass ${closing ? 'jv-hud-out' : 'jv-hud-in'}`}
        onAnimationEnd={handleAnimEnd}
        style={{ position: 'relative', width: 'min(720px, 92vw)', pointerEvents: 'auto', boxShadow: '0 0 40px rgba(0,212,255,0.12)' }}
      >
        {Object.entries(CORNERS).map(([p, s]) => (
          <span key={p} style={{ position: 'absolute', width: 8, height: 8, zIndex: 1, ...s }} />
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.22em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            ◉ HUD DISPLAY · {media.title}
          </span>
          {media.channel && (
            <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{media.channel}</span>
          )}
          <button
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
  );
}
