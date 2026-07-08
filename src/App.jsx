import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { C, display, mono, MODEL, clampPct } from './lib/constants.js';
import { useTelemetry } from './hooks/useTelemetry.js';
import { useSpeech } from './hooks/useSpeech.js';
import { useChat } from './hooks/useChat.js';
import { useVault } from './hooks/useVault.js';
import { TerminalView } from './components/TerminalView.jsx';
import { HudMediaWindow } from './components/HudMediaWindow.jsx';
import { VoicePanel } from './components/VoicePanel.jsx';
import { VoiceIndicator, MicButton } from './components/VoiceIndicator.jsx';
import { Meter } from './components/Meter.jsx';

// Lazy: o chunk do three.js (~680kB min) só carrega ao entrar no modo VAULT
const VaultBrain = lazy(() => import('./components/VaultBrain.jsx'));

const modules = [
  { id: '01', name: 'MATRIX', status: 'online' },
  { id: '02', name: 'NEXUS', status: 'online' },
  { id: '03', name: 'ARCHIVE', status: 'online' },
  { id: '04', name: 'DEFESA', status: 'online' },
  { id: '05', name: 'OVERWATCH', status: 'online' },
  { id: '06', name: 'VAULT', status: 'idle' },
  { id: '07', name: 'SYNTHESIA', status: 'online' },
  { id: '08', name: 'TRIBUNAL', status: 'online' },
  { id: '09', name: 'CRONOS', status: 'online' },
  { id: '10', name: 'FORGE', status: 'online' },
];

const sentinels = [
  { name: 'SEGURANÇA', state: 'ok' },
  { name: 'QUALIDADE', state: 'ok' },
  { name: 'POTÊNCIA ARC', state: 'ok' },
  { name: 'BEM-ESTAR', state: 'watch' },
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 30000;
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Folha isolada: assina o valor de latência e re-renderiza só a si mesma no
// tick de 100ms. Antes esse tick subia até o App e re-renderizava a árvore
// inteira 10×/s durante cada requisição.
function LatencyReadout({ subscribe, getInitial }) {
  const [ms, setMs] = useState(() => getInitial());
  useEffect(() => subscribe(setMs), [subscribe]);
  return (
    <div style={{ ...display, fontSize: 26, color: C.text, fontWeight: 300 }}>
      {Math.round(ms)}<span style={{ ...mono, fontSize: 11, color: C.muted, marginLeft: 6 }}>ms</span>
    </div>
  );
}

export default function JarvisOS() {
  const [bootStage, setBootStage] = useState(0);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('terminal');
  const [focusMode, setFocusMode] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState(null);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const apiHistoryRef = useRef([]);
  // Auto-scroll "grudento": só arrasta pro fim se o operador já estava perto do
  // fim. Se ele rolou pra cima pra reler, não brigamos com ele durante o stream.
  const stickToBottomRef = useRef(true);

  const { time, startTimer, stopTimer, subscribeLatency, getLatency } = useTelemetry();

  // Refs break the circular dependency between useSpeech ↔ useChat
  const submitCommandRef = useRef(null);

  const speech = useSpeech({
    onTranscriptReady: (text) => {
      submitCommandRef.current?.(text, { onModeChange: setMode, onFocusChange: setFocusMode });
    },
    setInput,
  });

  const chat = useChat({
    startTimer,
    stopTimer,
    apiHistoryRef,
    speakChunks: speech.speakChunks,
  });

  // Vault Obsidian — vive no App para sobreviver às trocas de modo
  const vault = useVault();

  // Keep ref current on every render so STT callback always calls the latest submitCommand
  submitCommandRef.current = chat.submitCommand;

  // Fontes agora são self-hosted via index.html (public/fonts/) — sem injeção
  // de <link> em runtime, sem FOUT, sem origem third-party sob COEP.

  useEffect(() => {
    const stages = [700, 900, 700, 700, 800];
    let acc = 0;
    const timers = stages.map((d, i) => { acc += d; return setTimeout(() => setBootStage(i + 1), acc); });

    // Pular a sequência de boot com qualquer tecla/clique — o operador não fica
    // preso a ~3,8s a cada F5. Auto-remove após o primeiro disparo.
    const skip = () => {
      timers.forEach(clearTimeout);
      setBootStage(5);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, []);

  // Observa a rolagem do terminal pra saber se o operador está "grudado" no fim.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || mode !== 'terminal') return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [mode]);

  useEffect(() => {
    if (scrollRef.current && mode === 'terminal' && stickToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.history, chat.thinking, chat.streamText, bootStage, mode]);

  useEffect(() => {
    if (bootStage === 5 && inputRef.current) inputRef.current.focus();
  }, [bootStage]);

  const ready = bootStage >= 5;

  // Contexto/tokens mudam ~1×/requisição — baratos de derivar no render.
  // A latência ao vivo agora é isolada no <LatencyReadout> (não re-renderiza o App).
  const contextPct = clampPct(Math.round(chat.apiHistory.length / 2 / 20 * 100));
  const sessionTokens = chat.sessionTokens;

  const handleSubmit = () => {
    if (!ready || !input.trim()) return;
    const cmd = input;
    const currentAttachment = attachment;
    setInput('');
    setAttachment(null);
    chat.submitCommand(cmd, { onModeChange: setMode, onFocusChange: setFocusMode, attachment: currentAttachment });
  };
  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachmentError(null);

    if (IMAGE_MEDIA_TYPES.includes(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) {
        setAttachmentError(`imagem muito grande · máximo ${formatBytes(MAX_IMAGE_BYTES)}`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1] || '';
        setAttachment({ name: file.name, sizeLabel: formatBytes(file.size), mediaType: file.type, kind: 'image', data: base64 });
      };
      reader.onerror = () => setAttachmentError('falha ao ler o arquivo');
      reader.readAsDataURL(file);
      return;
    }

    const isTextLike = file.type.startsWith('text/') || /\.(json|txt|cube|srt|log|csv|md|js|py)$/i.test(file.name);
    if (isTextLike) {
      const reader = new FileReader();
      reader.onload = () => {
        let text = reader.result;
        if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS) + '\n...[truncado]';
        setAttachment({ name: file.name, sizeLabel: formatBytes(file.size), mediaType: file.type || 'text/plain', kind: 'text', data: text });
      };
      reader.onerror = () => setAttachmentError('falha ao ler o arquivo');
      reader.readAsText(file);
      return;
    }

    setAttachmentError('tipo de arquivo não suportado');
  };

  // Nó do cérebro → JARVIS lê a nota (reusa o pipeline de anexos de texto)
  const handleAnalyzeNote = ({ title, path, content }) => {
    let data = content;
    if (data.length > MAX_TEXT_CHARS) data = data.slice(0, MAX_TEXT_CHARS) + '\n...[truncado]';
    chat.submitCommand(`Analise esta nota do meu vault Obsidian: "${title}"`, {
      onModeChange: setMode, onFocusChange: setFocusMode,
      attachment: {
        name: title.toLowerCase().endsWith('.md') ? title : `${title}.md`,
        sizeLabel: formatBytes(content.length),
        mediaType: 'text/markdown', kind: 'text', data,
      },
    });
  };

  const fmtTime = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDate = d => d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  return (
    <div style={{ ...mono, background: C.bg, color: C.text, minHeight: '100vh', width: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
        @keyframes pulseSoft { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeInScale { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
        @keyframes scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        @keyframes wave1 { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
        @keyframes wave2 { 0%, 100% { transform: scaleY(0.6); } 50% { transform: scaleY(0.4); } }
        @keyframes wave3 { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(0.9); } }
        @keyframes wave4 { 0%, 100% { transform: scaleY(0.8); } 50% { transform: scaleY(0.3); } }
        @keyframes wave5 { 0%, 100% { transform: scaleY(0.2); } 50% { transform: scaleY(0.7); } }
        @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(0,212,255,0.5); } 100% { box-shadow: 0 0 0 14px rgba(0,212,255,0); } }
        @keyframes drift { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } 100% { transform: translateY(0); } }
        @keyframes holoIn { from { opacity: 0; filter: blur(8px); } to { opacity: 1; filter: blur(0); } }
        @keyframes arcPulse { 0% { box-shadow: 0 0 0 0 rgba(0,212,255,0.7), 0 0 20px 4px rgba(0,212,255,0.3); } 70% { box-shadow: 0 0 0 18px rgba(0,212,255,0), 0 0 30px 8px rgba(0,212,255,0.15); } 100% { box-shadow: 0 0 0 0 rgba(0,212,255,0), 0 0 20px 4px rgba(0,212,255,0.3); } }
        @keyframes dataStream { 0% { transform: translateY(-100%); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 0.6; } 100% { transform: translateY(100vh); opacity: 0; } }
        @keyframes hexGlow { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.55; } }
        .jv-fade { animation: fadeIn 0.5s ease-out both; }
        .jv-scale-in { animation: fadeInScale 0.6s ease-out both; }
        .jv-blink { animation: blink 1.1s steps(1, end) infinite; }
        .jv-pulse { animation: pulseSoft 2.4s ease-in-out infinite; }
        .jv-ring { animation: ringPulse 1.6s ease-out infinite; }
        .jv-drift { animation: drift 6s ease-in-out infinite; }
        .jv-holo-in { animation: holoIn 1.2s ease-out both; }
        @keyframes hudIn { from { opacity: 0; transform: scale(0.92); filter: blur(8px); } to { opacity: 1; transform: scale(1); filter: blur(0); } }
        @keyframes hudOut { from { opacity: 1; transform: scale(1); filter: blur(0); } to { opacity: 0; transform: scale(0.94); filter: blur(6px); } }
        .jv-hud-in { animation: hudIn 0.45s ease-out both; }
        .jv-hud-out { animation: hudOut 0.3s ease-in both; }
        .jv-scanline { position: fixed; inset: 0; pointer-events: none; z-index: 5; background: linear-gradient(180deg, transparent, rgba(0,212,255,0.018) 50%, transparent); height: 120px; animation: scan 9s linear infinite; opacity: 0.7; }
        .jv-grain { position: fixed; inset: 0; pointer-events: none; z-index: 4; opacity: 0.025; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2' stitchTiles='stitch'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>"); }
        .jv-input::placeholder { color: #1e3a4a; }
        .jv-input { caret-color: #00d4ff; }
        .jv-input:focus { outline: none; }
        .jv-grid-bg { position: fixed; inset: 0; pointer-events: none; z-index: 1; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='115'><polygon points='50,2 98,26 98,74 50,98 2,74 2,26' fill='none' stroke='rgba(0,212,255,0.13)' stroke-width='0.8'/></svg>"); background-size: 100px 115px; animation: hexGlow 8s ease-in-out infinite; mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%); }
        .jv-wave-bar { display: inline-block; width: 2px; background: #00d4ff; transform-origin: center; }
        .jv-wave-bar:nth-child(1) { animation: wave1 0.9s ease-in-out infinite; }
        .jv-wave-bar:nth-child(2) { animation: wave2 0.7s ease-in-out infinite; }
        .jv-wave-bar:nth-child(3) { animation: wave3 1.1s ease-in-out infinite; }
        .jv-wave-bar:nth-child(4) { animation: wave4 0.8s ease-in-out infinite; }
        .jv-wave-bar:nth-child(5) { animation: wave5 1.0s ease-in-out infinite; }
        select.jv-select { background: transparent; color: #c8e8f8; border: 1px solid rgba(0,212,255,0.12); padding: 6px 10px; font-family: inherit; font-size: 11px; letter-spacing: 0.08em; cursor: pointer; }
        select.jv-select:focus { outline: 1px solid #00d4ff; }
        .jv-slider { -webkit-appearance: none; appearance: none; height: 2px; background: rgba(0,212,255,0.12); outline: none; }
        .jv-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; background: #00d4ff; border-radius: 50%; cursor: pointer; }
        .jv-holo-glass { background: rgba(5,10,20,0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(0,212,255,0.18); }
        .jv-ai-text { white-space: pre-wrap; word-break: break-word; line-height: 1.75; }
        .jv-ai-code { background: rgba(0,212,255,0.06); border: 1px solid rgba(0,212,255,0.14); padding: 10px 14px; margin: 8px 0; font-size: 11.5px; overflow-x: auto; white-space: pre; }
        .jv-scrollbar::-webkit-scrollbar { width: 4px; }
        .jv-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .jv-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.18); border-radius: 2px; }
        .jv-data-stream { position: fixed; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
        /* Foco visível pra teclado (não aparece em clique de mouse). O input mantém
           outline:none no :focus, mas ganha anel no :focus-visible. */
        .jv-input:focus-visible { outline: 1px solid ${C.accent}; outline-offset: 2px; }
        button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible, [tabindex]:focus-visible {
          outline: 1px solid ${C.accent}; outline-offset: 2px;
        }
        /* Movimento reduzido: silencia as animações ambientes e transições CSS.
           (O movimento em JS do three.js — autoRotate/física — será tratado na Fase 5.) */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.001ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.001ms !important;
            scroll-behavior: auto !important;
          }
          .jv-scanline, .jv-data-stream, .jv-grid-bg { animation: none !important; }
        }
      `}</style>

      <div className="jv-grid-bg" />
      <div className="jv-grain" />
      <div className="jv-scanline" />
      <div className="jv-data-stream">
        {[...Array(10)].map((_, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(i / 10) * 100 + (i % 3) * 2}%`, top: 0, width: 1, height: `${55 + (i % 4) * 35}px`, background: `linear-gradient(180deg, transparent, rgba(0,212,255,${0.25 + (i % 3) * 0.12}), transparent)`, animation: `dataStream ${5 + (i % 5) * 1.8}s linear ${(i % 7) * 0.9}s infinite` }} />
        ))}
      </div>

      {/* TOP BAR */}
      <header style={{ position: 'relative', zIndex: 10, borderBottom: `1px solid ${C.line}`, padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(5,10,20,0.88)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ ...display, fontSize: 22, fontWeight: 700, letterSpacing: '0.18em', color: C.accent }}>STARK INDUSTRIES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ color: C.muted, fontSize: 9, letterSpacing: '0.36em', textTransform: 'uppercase' }}>J.A.R.V.I.S. · Núcleo {MODEL.core}</div>
          </div>
          <div style={{ fontSize: 9, letterSpacing: '0.22em', color: C.ok, border: `1px solid ${C.ok}`, padding: '2px 7px', opacity: 0.85 }}>◉ ONLINE</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.line}`, padding: 2 }}>
            <button onClick={() => setMode('terminal')} style={{ background: mode === 'terminal' ? C.accent : 'transparent', color: mode === 'terminal' ? C.bg : C.muted, border: 'none', padding: '4px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>TERMINAL</button>
            <button onClick={() => setMode('holographic')} style={{ background: mode === 'holographic' ? C.accent : 'transparent', color: mode === 'holographic' ? C.bg : C.muted, border: 'none', padding: '4px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>VAULT</button>
          </div>
          <VoiceIndicator voiceOut={speech.voiceOut} speaking={speech.speaking} listening={speech.listening} onToggle={speech.toggleVoiceOut} onPanel={() => speech.setVoicePanelOpen(o => !o)} supported={speech.speechSupported} />
          <div style={{ color: C.muted }}>{fmtDate(time)}</div>
          <div style={{ color: C.text, fontWeight: 500 }}>{fmtTime(time)} <span style={{ color: C.muted }}>brt</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ready ? C.accent : C.warn }} className={ready ? 'jv-pulse' : ''} />
            <span style={{ color: C.muted }}>{ready ? 'núcleo' : 'iniciando'}</span>
          </div>
        </div>
      </header>

      {/* VOICE PANEL */}
      {speech.voicePanelOpen && (
        <VoicePanel
          voiceOut={speech.voiceOut}
          toggleVoiceOut={speech.toggleVoiceOut}
          elVoices={speech.elVoices}
          selectedVoiceId={speech.selectedVoiceId}
          setSelectedVoiceId={speech.setSelectedVoiceId}
          stability={speech.stability} setStability={speech.setStability}
          similarityBoost={speech.similarityBoost} setSimilarityBoost={speech.setSimilarityBoost}
          elStyle={speech.elStyle} setElStyle={speech.setElStyle}
          fallbackActive={speech.fallbackActive}
          elError={speech.elError}
          voices={speech.voices}
          selectedVoiceURI={speech.selectedVoiceURI}
          setSelectedVoiceURI={speech.setSelectedVoiceURI}
          rate={speech.rate} setRate={speech.setRate}
          pitch={speech.pitch} setPitch={speech.setPitch}
          speak={speech.speak}
          voiceError={speech.voiceError}
          sttError={speech.sttError}
          conversationMode={speech.conversationMode}
          setConversationMode={speech.setConversationMode}
          vadLoading={speech.vadLoading}
          apiError={chat.apiError}
          apiHistoryLength={apiHistoryRef.current.length / 2 | 0}
          onClearHistory={chat.clearHistory}
        />
      )}

      {/* BODY */}
      <div style={{ position: 'relative', zIndex: 10, display: 'grid', gridTemplateColumns: '220px 1fr 240px', minHeight: `calc(100vh - ${speech.voicePanelOpen ? '180px' : '56px'})` }}>

        {/* LEFT RAIL */}
        <aside style={{ borderRight: `1px solid ${C.line}`, padding: '24px 18px', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 18 }}>SUBSISTEMAS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11 }}>
            {modules.map((m, i) => (
              <div key={m.id} className="jv-fade" style={{ display: 'flex', alignItems: 'center', gap: 10, animationDelay: `${i * 80}ms` }}>
                <span style={{ color: C.dim, width: 18 }}>{m.id}</span>
                <span style={{ color: m.status === 'online' ? C.text : C.muted, flex: 1, letterSpacing: '0.08em' }}>{m.name}</span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.status === 'online' ? C.accent : C.dim }} className={m.status === 'online' ? 'jv-pulse' : ''} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 14 }}>HIERARQUIA</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 10.5 }}>
            {[['T0','J.A.R.V.I.S.','1'],['T1','Stark (Sir)','1'],['T2','Agentes','5'],['T3','Subsistemas','12'],['T4','Sentinelas','4']].map(([tier, name, count]) => (
              <div key={tier} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ color: C.accentDim, width: 22, fontSize: 9, letterSpacing: '0.1em' }}>{tier}</span>
                <span style={{ color: C.muted, flex: 1 }}>{name}</span>
                <span style={{ color: C.dim }}>{count}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 10 }}>CONTEXTO API</div>
            <div style={{ fontSize: 10, color: C.text }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.dim }}>TURNOS</span>
                <span style={{ color: C.accent }}>{Math.floor(apiHistoryRef.current.length / 2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.dim }}>TOKENS EST.</span>
                <span style={{ color: C.accent }}>{apiHistoryRef.current.reduce((a, m) => a + (m.content?.length || 0), 0) / 4 | 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.dim }}>MODELO</span>
                <span style={{ color: C.accentDim, fontSize: 9 }}>{MODEL.label}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER */}
        <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
          {focusMode && (
            <div style={{ borderBottom: `1px solid ${C.lineStrong}`, padding: '10px 32px', background: 'rgba(0,212,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.accent }}>◆ MODO FOCO · {focusMode.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.2em' }}>"/sair" para encerrar</div>
            </div>
          )}
          {speech.speaking && (
            <div style={{ borderBottom: `1px solid ${C.lineStrong}`, padding: '8px 32px', background: 'rgba(0,212,255,0.05)', display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 20 }}>
              <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', height: 14 }}>
                {[14,14,14,14,14].map((h,i) => <span key={i} className="jv-wave-bar" style={{ height: h }} />)}
              </span>
              <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.3em' }}>J.A.R.V.I.S. · TRANSMITINDO</span>
              <button onClick={speech.stopSpeaking} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accentDim, padding: '3px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>◾ SILENCIAR</button>
            </div>
          )}

          {mode === 'terminal' ? (
            <TerminalView scrollRef={scrollRef} bootStage={bootStage} history={chat.history} thinking={chat.thinking} streamText={chat.streamText} toolStatus={chat.toolStatus} onOpenHud={chat.openHudMedia} />
          ) : (
            <Suspense fallback={
              <div className="jv-pulse" style={{ flex: 1, minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, letterSpacing: '0.32em', color: C.accent }}>
                INICIALIZANDO NÚCLEO NEURAL…
              </div>
            }>
              <VaultBrain vault={vault} history={chat.history} thinking={chat.thinking} speaking={speech.speaking} listening={speech.listening} ready={ready} onAnalyzeNote={handleAnalyzeNote} />
            </Suspense>
          )}

          {/* COMMAND INPUT */}
          <div style={{ borderTop: `1px solid ${C.line}`, padding: '18px 32px 22px 32px', background: 'rgba(5,10,20,0.92)', backdropFilter: 'blur(8px)', position: 'relative', zIndex: 20 }}>
            {chat.apiError && (
              <div style={{ marginBottom: 10, fontSize: 10, color: C.critical, letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,60,60,0.08)', border: `1px solid ${C.critical}`, borderRadius: 4 }}>
                <div style={{ flex: 1 }}>
                  <div>⚠ {chat.apiError}</div>
                  {chat.showErrorDetails && chat.errorDetails && (
                    <div style={{ marginTop: 6, fontSize: 9, color: C.muted, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                      <div><strong>Tipo:</strong> {chat.errorDetails.type}</div>
                      <div><strong>Mensagem:</strong> {chat.errorDetails.fullMessage}</div>
                      {chat.errorDetails.stack && <div><strong>Stack:</strong> {chat.errorDetails.stack.split('\n')[0]}</div>}
                    </div>
                  )}
                </div>
                <button onClick={() => chat.setShowErrorDetails(!chat.showErrorDetails)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>ℹ</button>
                {chat.lastFailedCmd && (
                  <button onClick={() => { chat.setApiError(null); chat.setErrorDetails(null); chat.setShowErrorDetails(false); chat.retryLastCommand(); }} style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, padding: '2px 8px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.18em', cursor: 'pointer', whiteSpace: 'nowrap' }}>↺ RETRY</button>
                )}
                <button onClick={() => { chat.setApiError(null); chat.setErrorDetails(null); chat.setShowErrorDetails(false); }} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
            {chat.activeBadge && (
              <div className="jv-fade" style={{ fontSize: 9, letterSpacing: '0.32em', color: C.accent, border: `1px solid ${C.accent}`, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>
                ◉ {chat.activeBadge}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: chat.thinking ? C.warn : C.accent, fontSize: 13 }}>{chat.thinking ? '⟳' : '⟢'}</span>
              <input
                ref={inputRef}
                className="jv-input"
                disabled={!ready || chat.thinking}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={speech.partialTranscript ? 'ouvindo...' : speech.listening ? 'canal de voz aberto...' : speech.vadLoading ? 'inicializando VAD...' : chat.thinking ? 'processando na matrix neural...' : ready ? 'aguardando instrução, Sir...' : 'inicializando...'}
                style={{ ...mono, flex: 1, background: 'transparent', border: 'none', color: C.text, fontSize: 14, letterSpacing: '0.02em', padding: '4px 0' }}
              />
              <MicButton listening={speech.listening} onStart={speech.startListening} onStop={speech.stopListening} disabled={!speech.recogSupported || chat.thinking || !ready || !!speech.partialTranscript || speech.vadLoading} />
              <input ref={fileInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp,.json,.txt,.cube,.srt,.log,.csv,.md,.js,.py" onChange={handleFileSelect} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!ready || chat.thinking}
                title="Anexar arquivo ou imagem"
                style={{ background: attachment ? C.accent : 'transparent', color: attachment ? C.bg : C.accentDim, border: `1px solid ${C.accentDim}`, padding: '6px 12px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.18em', cursor: !ready || chat.thinking ? 'not-allowed' : 'pointer' }}
              >▸ ANEXO</button>
              <button onClick={handleSubmit} disabled={!ready || chat.thinking || !input.trim()} style={{ background: 'transparent', border: `1px solid ${input.trim() ? C.accentDim : C.dim}`, color: input.trim() ? C.accent : C.dim, padding: '6px 14px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: input.trim() && !chat.thinking ? 'pointer' : 'not-allowed' }}>
                ▸ ENVIAR
              </button>
              <span className="jv-blink" style={{ color: C.accent, fontSize: 14 }}>▌</span>
            </div>
            {speech.partialTranscript && (
              <div className="jv-fade" style={{ marginTop: 6, fontSize: 12, color: C.muted, letterSpacing: '0.04em', fontStyle: 'italic' }}>
                ◎ {speech.partialTranscript}
              </div>
            )}
            {attachment && (
              <div className="jv-fade" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: C.accentDim, letterSpacing: '0.08em', border: `1px solid ${C.line}`, padding: '5px 10px', width: 'fit-content' }}>
                <span>▸ {attachment.name} · {attachment.sizeLabel}</span>
                <button onClick={() => setAttachment(null)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 11 }}>✕</button>
              </div>
            )}
            {attachmentError && (
              <div className="jv-fade" style={{ marginTop: 8, fontSize: 10, color: C.warn, letterSpacing: '0.08em' }}>
                ⚠ {attachmentError}
              </div>
            )}
            <div style={{ marginTop: 10, display: 'flex', gap: 18, fontSize: 9.5, color: C.dim, letterSpacing: '0.22em', flexWrap: 'wrap' }}>
              <span>/VAULT</span><span>/HOLO</span><span>/TERMINAL</span><span>/FOCO [tema]</span><span>/STATUS</span><span>/SAIR</span>
              <span style={{ color: C.accentDim }}>↵ tudo mais vai para a IA</span>
              <span style={{ marginLeft: 'auto', color: speech.voiceOut ? C.accent : C.dim }}>{speech.voiceOut ? '◉ VOZ ATIVA' : '○ VOZ'}</span>
            </div>
          </div>
        </main>

        {/* RIGHT RAIL */}
        <aside style={{ borderLeft: `1px solid ${C.line}`, padding: '24px 20px', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 18 }}>TELEMETRIA</div>
          <Meter label="CONTEXTO IA" value={contextPct} unit="%" />
          {/* max = orçamento macio da sessão só pra dar escala à barra — o valor
              exibido é a contagem real de tokens acumulados. */}
          <Meter label="TOKENS SESSÃO" value={sessionTokens} max={100000} display={`${sessionTokens.toLocaleString('pt-BR')} tk`} />
          <div style={{ marginTop: 16, marginBottom: 22 }}>
            <div style={{ fontSize: 9, color: C.dim, letterSpacing: '0.28em', marginBottom: 6 }}>LATÊNCIA API</div>
            <LatencyReadout subscribe={subscribeLatency} getInitial={getLatency} />
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 20, marginBottom: 22 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 14 }}>SENTINELAS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11 }}>
              {sentinels.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.state === 'ok' ? C.ok : C.warn }} className="jv-pulse" />
                  <span style={{ color: C.text, flex: 1, letterSpacing: '0.06em' }}>{s.name}</span>
                  <span style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em' }}>{s.state}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 18 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 8 }}>OPERADOR</div>
            <div style={{ ...display, color: C.accent, fontSize: 11, fontWeight: 500, letterSpacing: '0.28em' }}>SIR · GABRIEL</div>
            <div style={{ ...display, color: C.text, fontSize: 18, marginTop: 2 }}>Schoenardie</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4, letterSpacing: '0.12em' }}>engenharia de vídeo · cinema</div>
            <div style={{ marginTop: 14, fontSize: 9, color: C.accentDim, letterSpacing: '0.16em' }}>Canoas · BRT -3</div>
          </div>
        </aside>
      </div>

      <HudMediaWindow media={chat.hudMedia} onClose={chat.closeHudMedia} />
    </div>
  );
}
