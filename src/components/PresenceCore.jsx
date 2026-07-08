import { C, mono } from '../lib/constants.js';

// ── Presence Core ───────────────────────────────────────────────────────────
// O elemento-assinatura do HUD: um arc-reactor 2D (SVG) cujo MOVIMENTO é a
// máquina de estados do JARVIS. Mesma linguagem ciano do núcleo 3D do VAULT —
// um só ser, duas projeções. Os keyframes (pc-*) vivem no bloco <style> do
// App.jsx, junto das outras animações do projeto; sob prefers-reduced-motion
// eles são silenciados e o core repousa num estado estático aceso.
//
// Regra do projeto: nada brilha em repouso. O brilho é orçado e gasto nas
// mudanças de estado (ouvindo / pensando / falando / executando ferramenta).

const COILS = Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2);
const CENTER = 60;

// Cada estado define brilho do halo, velocidades de rotação dos anéis, a
// animação do núcleo, a opacidade das bobinas e se as ondas de fala estão on.
const STATES = {
  idle:      { halo: 0.26, outer: '26s', inner: '20s', core: 'pc-breathe 4s',   coils: 0.45, ripple: false, word: 'EM ESPERA',   active: false },
  listening: { halo: 0.50, outer: '10s', inner: '8s',  core: 'pc-breathe 2.4s', coils: 0.80, ripple: false, word: 'OUVINDO',     active: true  },
  thinking:  { halo: 0.55, outer: '3s',  inner: '2s',  core: 'pc-pulse 0.7s',   coils: 1.00, ripple: false, word: 'PROCESSANDO', active: true  },
  tool:      { halo: 0.60, outer: '2.6s',inner: '1.8s',core: 'pc-pulse 0.9s',   coils: 1.00, ripple: false, word: 'EXECUTANDO',  active: true  },
  speaking:  { halo: 0.50, outer: '16s', inner: '12s', core: 'pc-breathe 1.4s', coils: 0.75, ripple: true,  word: 'TRANSMITINDO', active: true  },
};

function deriveState({ thinking, speaking, listening, toolStatus }) {
  if (toolStatus) return 'tool';
  if (thinking) return 'thinking';
  if (speaking) return 'speaking';
  if (listening) return 'listening';
  return 'idle';
}

const spin = (name, duration) => ({
  transformBox: 'fill-box',
  transformOrigin: 'center',
  animation: `${name} ${duration} linear infinite`,
});

export function PresenceCore({ size = 120, thinking, speaking, listening, toolStatus }) {
  const key = deriveState({ thinking, speaking, listening, toolStatus });
  const s = STATES[key];
  const stroke = C.accent;
  const caption = key === 'tool' ? `EXECUTANDO · ${toolStatus}` : s.word;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        role="img"
        aria-label={`J.A.R.V.I.S. — ${caption}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <radialGradient id="pcHalo" cx="50%" cy="50%" r="50%">
            <stop offset="35%" stopColor={stroke} stopOpacity="0.5" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="pcCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#eafaff" />
            <stop offset="55%" stopColor={stroke} />
            <stop offset="100%" stopColor={C.accentDim} />
          </radialGradient>
        </defs>

        {/* Halo ambiente — pulsa de leve, intensidade por estado */}
        <circle cx={CENTER} cy={CENTER} r="58" fill="url(#pcHalo)" style={{ opacity: s.halo, transition: 'opacity 600ms ease' }} />

        {/* Ondas de fala — só quando falando; escala (GPU) em vez de animar r */}
        {s.ripple && (
          <g style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <circle cx={CENTER} cy={CENTER} r="22" fill="none" stroke={stroke} strokeWidth="1.5"
              style={{ animation: 'pc-ripple 1.8s ease-out infinite' }} />
            <circle cx={CENTER} cy={CENTER} r="22" fill="none" stroke={stroke} strokeWidth="1.5"
              style={{ animation: 'pc-ripple 1.8s ease-out 0.9s infinite' }} />
          </g>
        )}

        {/* Anel externo segmentado — gira */}
        <circle cx={CENTER} cy={CENTER} r="54" fill="none" stroke={stroke} strokeWidth="1"
          strokeDasharray="2 7" style={{ ...spin('pc-spin', s.outer), opacity: 0.35 + s.coils * 0.4 }} />

        {/* Anel de abertura (aperture) — contra-gira, tem uma fenda */}
        <circle cx={CENTER} cy={CENTER} r="45" fill="none" stroke={stroke} strokeWidth="2"
          strokeDasharray="150 62" strokeLinecap="round"
          style={{ ...spin('pc-spin-rev', s.inner), opacity: 0.3 + s.coils * 0.5 }} />

        {/* Bobinas do reator — 9 raios curtos */}
        <g style={{ opacity: s.coils, transition: 'opacity 400ms ease' }}>
          {COILS.map((a, i) => {
            const x1 = CENTER + Math.cos(a) * 23, y1 = CENTER + Math.sin(a) * 23;
            const x2 = CENTER + Math.cos(a) * 31, y2 = CENTER + Math.sin(a) * 31;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />;
          })}
        </g>

        {/* Marcador orbital — só no estado de ferramenta */}
        {key === 'tool' && (
          <g style={spin('pc-spin', '1.4s')}>
            <circle cx={CENTER} cy={CENTER - 45} r="3.2" fill="#eafaff" />
          </g>
        )}

        {/* Núcleo — respira/pulsa conforme o estado */}
        <g style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: s.core + ' ease-in-out infinite', filter: `drop-shadow(0 0 6px ${stroke})` }}>
          <circle cx={CENTER} cy={CENTER} r="13" fill="url(#pcCore)" />
          <circle cx={CENTER} cy={CENTER} r="5" fill="#eafaff" />
        </g>
      </svg>

      <div style={{ ...mono, fontSize: 9, letterSpacing: '0.32em', color: s.active ? C.accent : C.dim, transition: 'color 400ms ease', whiteSpace: 'nowrap' }}>
        {caption}
      </div>
    </div>
  );
}
