import { useState, useRef } from 'react';
import { C, display } from '../lib/constants.js';

// Glifos com ︎ (variation selector de texto) para nunca renderizarem como
// emoji colorido — mantêm a cor ciano da marca.
function glyphFor(code) {
  if (code === 0 || code === 1) return '☀︎';        // ☀ limpo
  if (code === 2) return '⛅︎';                       // ⛅ parcial
  if (code === 3) return '☁︎';                       // ☁ nublado
  if (code === 45 || code === 48) return '≡';             // ≡ neblina
  if (code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82) return '❄︎'; // ❄ neve
  if (code >= 95) return '⚡︎';                       // ⚡ trovoada
  if (code >= 51) return '☂︎';                       // ☂ chuva/garoa
  return '☀︎';
}

function weekdayAbbrev(dateStr) {
  // T12:00 evita shift de fuso ao converter só a data
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' });
}

const TABS = [
  { key: 'temp', label: 'TEMPERATURA' },
  { key: 'rain', label: 'CHUVA' },
  { key: 'wind', label: 'VENTO' },
];

// Geometria do SVG (viewBox fixo, escala uniforme via width 100%)
const W = 640, H = 150;
const M = { top: 14, right: 10, bottom: 22, left: 34 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

function corner(pos) {
  const s = { position: 'absolute', width: 8, height: 8 };
  const b = `1px solid ${C.accent}`;
  const map = {
    tl: { ...s, top: -1, left: -1, borderTop: b, borderLeft: b },
    tr: { ...s, top: -1, right: -1, borderTop: b, borderRight: b },
    bl: { ...s, bottom: -1, left: -1, borderBottom: b, borderLeft: b },
    br: { ...s, bottom: -1, right: -1, borderBottom: b, borderRight: b },
  };
  return map[pos];
}

// Barra com topo levemente arredondado (2px) e base reta, como manda a spec
function topRoundedBar(x, y, w, h, r = 2) {
  if (h <= r) return `M ${x} ${y + h} L ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} Z`;
  return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
}

function TempChart({ hourly, onHover, hover }) {
  const pts = hourly.filter(p => p.tempC != null);
  if (pts.length < 2) return null;

  const temps = pts.map(p => p.tempC);
  const tMin = Math.floor(Math.min(...temps)) - 1;
  const tMax = Math.ceil(Math.max(...temps)) + 1;
  const x = i => M.left + (i / (pts.length - 1)) * PW;
  const y = t => M.top + PH - ((t - tMin) / (tMax - tMin)) * PH;

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.tempC).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(pts.length - 1).toFixed(1)} ${M.top + PH} L ${M.left} ${M.top + PH} Z`;

  const gridTemps = [tMin, (tMin + tMax) / 2, tMax];

  const handleMove = (e) => {
    const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((fx - M.left) / PW) * (pts.length - 1))));
    const p = pts[i];
    const hour = p.time.slice(11, 13);
    onHover({
      xPct: (x(i) / W) * 100,
      yPct: (y(p.tempC) / H) * 100,
      value: `${Math.round(p.tempC)}°`,
      label: `${hour}h${p.rainChance != null ? ` · chuva ${p.rainChance}%` : ''}`,
      cx: x(i), cy: y(p.tempC),
    });
  };

  return (
    <>
      <defs>
        <linearGradient id="jvTempGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridTemps.map(t => (
        <g key={t}>
          <line x1={M.left} y1={y(t)} x2={W - M.right} y2={y(t)} stroke="rgba(0,212,255,0.07)" strokeWidth="1" />
          <text x={M.left - 6} y={y(t) + 3} textAnchor="end" fill={C.dim} fontSize="8" fontFamily="JetBrains Mono, monospace">{Math.round(t)}°</text>
        </g>
      ))}
      {pts.map((p, i) => {
        const hour = p.time.slice(11, 13);
        if (i % 6 !== 0) return null;
        const isMidnight = hour === '00';
        return (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fill={isMidnight ? C.muted : C.dim} fontSize="8" fontFamily="JetBrains Mono, monospace">
            {isMidnight ? weekdayAbbrev(p.time.slice(0, 10)) : `${hour}h`}
          </text>
        );
      })}
      <path d={area} fill="url(#jvTempGrad)" />
      <path d={line} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {hover && (
        <>
          <line x1={hover.cx} y1={M.top} x2={hover.cx} y2={M.top + PH} stroke="rgba(0,212,255,0.35)" strokeWidth="1" />
          <circle cx={hover.cx} cy={hover.cy} r="4" fill={C.accent} stroke={C.bg} strokeWidth="2" />
        </>
      )}
      <rect
        x={M.left} y={M.top} width={PW} height={PH} fill="transparent"
        onPointerMove={handleMove}
        onPointerLeave={() => onHover(null)}
      />
    </>
  );
}

function DailyBars({ daily, field, unit, max, onHover, hover }) {
  const band = PW / daily.length;
  const barW = Math.min(24, band - 8);
  const y = v => M.top + PH - (v / max) * PH;

  return (
    <>
      {[0, max / 2, max].map(v => (
        <g key={v}>
          <line x1={M.left} y1={y(v)} x2={W - M.right} y2={y(v)} stroke="rgba(0,212,255,0.07)" strokeWidth="1" />
          <text x={M.left - 6} y={y(v) + 3} textAnchor="end" fill={C.dim} fontSize="8" fontFamily="JetBrains Mono, monospace">{Math.round(v)}</text>
        </g>
      ))}
      {daily.map((d, i) => {
        const v = d[field] ?? 0;
        const bx = M.left + i * band + (band - barW) / 2;
        const by = y(v);
        const isHover = hover?.i === i;
        return (
          <g key={d.date}>
            <path d={topRoundedBar(bx, by, barW, M.top + PH - by)} fill={C.accent} opacity={isHover ? 0.95 : 0.65} />
            <text x={bx + barW / 2} y={by - 5} textAnchor="middle" fill={C.text} fontSize="9" fontFamily="JetBrains Mono, monospace">{Math.round(v)}</text>
            <text x={bx + barW / 2} y={H - 6} textAnchor="middle" fill={C.dim} fontSize="8" fontFamily="JetBrains Mono, monospace">{weekdayAbbrev(d.date)}</text>
            <rect
              x={M.left + i * band} y={M.top} width={band} height={PH} fill="transparent"
              tabIndex={0}
              onPointerEnter={() => onHover({ i, xPct: ((bx + barW / 2) / W) * 100, yPct: (by / H) * 100, value: `${Math.round(v)} ${unit}`, label: `${weekdayAbbrev(d.date)} · ${d.conditionText}` })}
              onFocus={() => onHover({ i, xPct: ((bx + barW / 2) / W) * 100, yPct: (by / H) * 100, value: `${Math.round(v)} ${unit}`, label: `${weekdayAbbrev(d.date)} · ${d.conditionText}` })}
              onPointerLeave={() => onHover(null)}
              onBlur={() => onHover(null)}
              style={{ outline: 'none' }}
            />
          </g>
        );
      })}
    </>
  );
}

export function WeatherCard({ forecast }) {
  const [tab, setTab] = useState('temp');
  const [hover, setHover] = useState(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const containerRef = useRef(null);

  const { current, hourly = [], daily = [], city, country } = forecast || {};
  if (!daily.length) return null;

  const location = city ? `${city.toUpperCase()}${country ? ' · ' + country : ''}` : 'LOCAL DETECTADO POR IP';
  const sel = daily[selectedDay] || daily[0];
  const maxRain = 100;
  const maxWind = Math.max(10, Math.ceil(Math.max(...daily.map(d => d.windMaxKmh ?? 0)) / 10) * 10);

  // Tooltip clampado nas bordas
  const tipTransform = hover
    ? hover.xPct > 78 ? 'translate(-100%, -120%)' : hover.xPct < 12 ? 'translate(0, -120%)' : 'translate(-50%, -120%)'
    : undefined;

  return (
    <div ref={containerRef} className="jv-holo-in" style={{ position: 'relative', border: `1px solid ${C.line}`, background: 'rgba(0,212,255,0.03)', padding: '16px 18px', maxWidth: 680 }}>
      {['tl', 'tr', 'bl', 'br'].map(p => <span key={p} style={corner(p)} />)}

      {/* Header */}
      <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.28em', marginBottom: 12 }}>
        ◉ PREVISÃO · 7 DIAS · {location}
      </div>

      {/* Condições atuais */}
      {current && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ ...display, fontSize: 34, fontWeight: 600, color: C.text, lineHeight: 1 }}>
            {Math.round(current.tempC)}°C
          </span>
          <span style={{ fontSize: 11, color: C.muted, letterSpacing: '0.08em' }}>{current.conditionText}</span>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.08em' }}>
            umidade {current.humidity}% · vento {Math.round(current.windKmh)} km/h
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, padding: 2, marginBottom: 10 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setHover(null); }}
            style={{
              background: tab === t.key ? C.accent : 'transparent',
              color: tab === t.key ? C.bg : C.muted,
              border: 'none', padding: '4px 10px', fontFamily: 'inherit',
              fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Gráfico */}
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
          {tab === 'temp' && <TempChart hourly={hourly} onHover={setHover} hover={hover} />}
          {tab === 'rain' && <DailyBars daily={daily} field="rainChance" unit="%" max={maxRain} onHover={setHover} hover={hover} />}
          {tab === 'wind' && <DailyBars daily={daily} field="windMaxKmh" unit="km/h" max={maxWind} onHover={setHover} hover={hover} />}
        </svg>
        {hover && (
          <div className="jv-holo-glass" style={{
            position: 'absolute', left: `${hover.xPct}%`, top: `${hover.yPct}%`,
            transform: tipTransform, pointerEvents: 'none',
            padding: '5px 10px', whiteSpace: 'nowrap', zIndex: 5,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{hover.value}</div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em' }}>{hover.label}</div>
          </div>
        )}
      </div>

      {/* Régua de 7 dias */}
      <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
        {daily.map((d, i) => {
          const selected = i === selectedDay;
          return (
            <button
              key={d.date}
              onClick={() => setSelectedDay(i)}
              style={{
                flex: 1, background: selected ? 'rgba(0,212,255,0.07)' : 'transparent',
                border: `1px solid ${selected ? C.lineStrong : 'transparent'}`,
                padding: '8px 2px', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 9, color: selected ? C.text : C.muted, letterSpacing: '0.12em' }}>{weekdayAbbrev(d.date)}</span>
              <span style={{ fontSize: 16, color: C.accent, lineHeight: 1 }}>{glyphFor(d.code)}</span>
              <span style={{ fontSize: 11, color: C.text }}>
                {Math.round(d.maxC)}° <span style={{ color: C.muted, fontSize: 10 }}>{Math.round(d.minC)}°</span>
              </span>
              <span style={{ width: '70%', height: 2, background: 'rgba(0,212,255,0.10)' }}>
                <span style={{ display: 'block', width: `${d.rainChance ?? 0}%`, height: '100%', background: C.accent }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Rodapé */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 9, letterSpacing: '0.2em' }}>
        <span style={{ color: C.muted }}>
          {weekdayAbbrev(sel.date).toUpperCase()} · {sel.conditionText.toUpperCase()} · CHUVA {sel.rainChance ?? 0}%
        </span>
        <span style={{ color: C.dim }}>FONTE · OPEN-METEO</span>
      </div>
    </div>
  );
}
