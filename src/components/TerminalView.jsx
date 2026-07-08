import { memo, useMemo } from 'react';
import { C, display, MODEL } from '../lib/constants.js';
import { WeatherCard } from './WeatherCard.jsx';

// memo: o parser de markdown roda de novo só quando o `text` daquela mensagem
// muda. Antes, cada delta do stream re-parseava TODO o histórico.
const AIText = memo(function AIText({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let inCode = false;
  let codeLines = [];

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (inCode) {
        elements.push(<pre key={`code-${i}`} className="jv-ai-code" style={{ color: C.accent, fontFamily: '"JetBrains Mono", monospace' }}>{codeLines.join('\n')}</pre>);
        codeLines = []; inCode = false;
      } else { inCode = true; }
      return;
    }
    if (inCode) { codeLines.push(line); return; }
    if (line.startsWith('# ')) {
      elements.push(<div key={i} style={{ fontSize: 16, color: C.accent, fontWeight: 500, margin: '10px 0 6px', letterSpacing: '0.04em' }}>{line.slice(2)}</div>);
    } else if (line.startsWith('## ')) {
      elements.push(<div key={i} style={{ fontSize: 13.5, color: C.text, fontWeight: 500, margin: '8px 0 4px', letterSpacing: '0.06em' }}>{line.slice(3)}</div>);
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(<div key={i} style={{ display: 'flex', gap: 10, padding: '2px 0', color: C.text, fontSize: 13 }}><span style={{ color: C.accentDim }}>▸</span><span>{line.slice(2)}</span></div>);
    } else if (line.match(/^`[^`]+`$/)) {
      elements.push(<code key={i} style={{ background: 'rgba(0,212,255,0.07)', color: C.accent, padding: '1px 6px', fontSize: 12 }}>{line.slice(1,-1)}</code>);
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      elements.push(
        <div key={i} style={{ fontSize: 13.5, color: C.text, lineHeight: 1.75, marginBottom: 2 }}>
          {parts.map((p, j) => {
            if (p.startsWith('**') && p.endsWith('**')) return <strong key={j} style={{ color: C.accent, fontWeight: 600 }}>{p.slice(2,-2)}</strong>;
            if (p.startsWith('`') && p.endsWith('`')) return <code key={j} style={{ background: 'rgba(0,212,255,0.07)', color: C.accent, padding: '1px 5px', fontSize: 11.5 }}>{p.slice(1,-1)}</code>;
            return p;
          })}
        </div>
      );
    }
  });

  return <div>{elements}</div>;
});

function JarvisLabel({ children }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ color: C.accent, fontSize: 10, letterSpacing: '0.22em', minWidth: 88, paddingTop: 3 }}>J.A.R.V.I.S.</span>
      <div style={{ flex: 1, maxWidth: '100%', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function JarvisResponse({ msg, onOpenHud }) {
  if (msg.type === 'ai') {
    return <JarvisLabel><AIText text={msg.text} /></JarvisLabel>;
  }
  if (msg.type === 'weather') {
    return <JarvisLabel><WeatherCard forecast={msg.forecast} /></JarvisLabel>;
  }
  if (msg.type === 'action') {
    return (
      <JarvisLabel>
        <a
          href={msg.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', fontSize: 10, color: C.accent, letterSpacing: '0.18em',
            border: `1px solid ${C.accentDim}`, padding: '5px 12px', textDecoration: 'none',
          }}
        >
          ▸ ABRIR · {msg.label}
        </a>
      </JarvisLabel>
    );
  }
  if (msg.type === 'hud') {
    return (
      <JarvisLabel>
        <button
          onClick={() => onOpenHud?.({ videoId: msg.videoId, title: msg.title, channel: msg.channel })}
          style={{
            display: 'inline-block', fontSize: 10, color: C.accent, letterSpacing: '0.18em',
            border: `1px solid ${C.accentDim}`, padding: '5px 12px', background: 'transparent',
            fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          ▸ REPRODUZIR · {msg.title}
        </button>
      </JarvisLabel>
    );
  }
  if (msg.type === 'focus') {
    return (
      <JarvisLabel>
        <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.75 }}>
          <div style={{ color: C.accent, marginBottom: 6 }}>◆ Modo foco ativado — {msg.topic}</div>
          <div style={{ color: C.muted }}>Sentinelas em silêncio. Notificações suspensas.</div>
          <div style={{ color: C.muted }}>Bloco sugerido: 90 minutos.</div>
        </div>
      </JarvisLabel>
    );
  }
  return (
    <JarvisLabel>
      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.75 }}>
        {(msg.lines || []).map((l, i) => <div key={i} className="jv-fade" style={{ animationDelay: `${i*120}ms`, marginBottom: 4 }}>{l}</div>)}
      </div>
    </JarvisLabel>
  );
}

function OperatorLine({ msg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
      <span style={{ color: C.dim, fontSize: 10, letterSpacing: '0.22em', minWidth: 88 }}>SIR · GABRIEL</span>
      <span style={{ color: C.text, fontSize: 13.5 }}>{msg.content}</span>
      {msg.attachment && (
        <span style={{ fontSize: 9, color: C.accentDim, letterSpacing: '0.1em', border: `1px solid ${C.line}`, padding: '2px 8px' }}>
          ▸ ANEXO · {msg.attachment.name}
        </span>
      )}
    </div>
  );
}

function ThinkingIndicator({ toolStatus }) {
  return (
    <div className="jv-fade" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
      <span style={{ color: C.accentDim, fontSize: 10, letterSpacing: '0.22em', minWidth: 88 }}>J.A.R.V.I.S.</span>
      <span style={{ color: toolStatus ? C.accent : C.muted, fontSize: 11.5, letterSpacing: '0.12em' }}>
        <span className="jv-pulse">
          {toolStatus ? `▸ EXECUTANDO · ${toolStatus}` : 'processando na matrix neural · aguardando resposta'}
        </span>
        <span className="jv-blink" style={{ marginLeft: 6 }}>···</span>
      </span>
    </div>
  );
}

function BootSequence({ stage }) {
  const lines = [
    'reatores de arco · pressão nominal · OK',
    'matriz neural · sincronizada · L1·L2·L3 ativos',
    'stark industries DB · 847.293 registros · online',
    `api claude · ${MODEL.label} · handshake completo`,
  ];
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5, color: C.muted }}>
        {lines.map((l, i) => (
          <div key={i} className="jv-fade" style={{ display: stage > i ? 'flex' : 'none', alignItems: 'center', gap: 12, letterSpacing: '0.08em' }}>
            <span style={{ color: C.accent, fontSize: 9 }}>◉</span>
            <span>{l}</span>
            <span style={{ flex: 1, height: 1, background: C.line }} />
            <span style={{ color: C.accentDim, fontSize: 9, letterSpacing: '0.2em' }}>OK</span>
          </div>
        ))}
      </div>
      {stage >= 5 && (
        <div className="jv-fade" style={{ marginTop: 28 }}>
          <div style={{ ...display, fontSize: 32, fontWeight: 300, color: C.text, lineHeight: 1.2 }}>
            J.A.R.V.I.S. <span style={{ color: C.accent }}>online</span>. Pronto para servir, Sir.
          </div>
          <div style={{ marginTop: 12, fontSize: 12.5, color: C.muted, letterSpacing: '0.04em', lineHeight: 1.7 }}>
            Núcleo <span style={{ color: C.accent }}>Stark Industries</span> conectado via <span style={{ color: C.accent }}>claude-{MODEL.label}</span>. Histórico mantido durante a sessão.
          </div>
        </div>
      )}
    </div>
  );
}

export function TerminalView({ scrollRef, bootStage, history, thinking, streamText, toolStatus, onOpenHud }) {
  // As linhas do histórico só são recriadas quando o próprio histórico muda
  // (ou o onOpenHud, que agora é estável). Durante o stream, `streamText` muda
  // a cada frame mas `history` não — então esta lista é reaproveitada e não
  // re-renderiza nem re-parseia nada do que já foi dito.
  const rows = useMemo(
    () => history.map((msg, i) => (
      <div key={i} className="jv-fade" style={{ marginBottom: 28 }}>
        {msg.role === 'operator' ? <OperatorLine msg={msg} /> : <JarvisResponse msg={msg} onOpenHud={onOpenHud} />}
      </div>
    )),
    [history, onOpenHud]
  );

  // padding-bottom generoso: o conteúdo repousa acima do Presence Core
  // flutuante ancorado ao prompt, sem ficar escondido atrás dele.
  return (
    <div ref={scrollRef} className="jv-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '36px 56px 150px 56px' }}>
      <BootSequence stage={bootStage} />
      {rows}
      {thinking && !streamText && <ThinkingIndicator toolStatus={toolStatus} />}
      {thinking && streamText && (
        <div style={{ marginBottom: 28 }}>
          <JarvisLabel>
            <AIText text={streamText} />
            <span className="jv-blink" style={{ color: C.accent, fontSize: 13 }}>▌</span>
            {toolStatus && (
              <div className="jv-pulse" style={{ marginTop: 8, fontSize: 10, color: C.accent, letterSpacing: '0.18em' }}>
                ▸ EXECUTANDO · {toolStatus}
              </div>
            )}
          </JarvisLabel>
        </div>
      )}
    </div>
  );
}
