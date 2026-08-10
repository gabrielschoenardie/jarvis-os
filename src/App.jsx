import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { C, display, mono, glass, MODEL, clampPct } from './lib/constants.js';
import { Corners, HudButton } from './components/hud/index.js';
import { useTelemetry } from './hooks/useTelemetry.js';
import { useSpeech } from './hooks/useSpeech.js';
import { useChat } from './hooks/useChat.js';
import { useVault } from './hooks/useVault.js';
import { TerminalView } from './components/TerminalView.jsx';
import { StatusStrip } from './components/StatusStrip.jsx';
import { MemoryPanel } from './components/MemoryPanel.jsx';
import { HudMediaWindow } from './components/HudMediaWindow.jsx';
import { VoicePanel } from './components/VoicePanel.jsx';
import { VoiceIndicator, MicButton } from './components/VoiceIndicator.jsx';
import { Meter } from './components/Meter.jsx';
import { PresenceCore } from './components/PresenceCore.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

// Lazy: o chunk do three.js (~680kB min) só carrega ao entrar no modo VAULT
const VaultBrain = lazy(() => import('./components/VaultBrain.jsx'));

// VAULT tem sinal vivo real (vault.status); os outros nove são cenário —
// sem campo de status próprio, porque nenhum dado real está por trás deles.
const modules = [
  { id: '01', name: 'MATRIX' },
  { id: '02', name: 'NEXUS' },
  { id: '03', name: 'ARCHIVE' },
  { id: '04', name: 'DEFESA' },
  { id: '05', name: 'OVERWATCH' },
  { id: '06', name: 'VAULT' },
  { id: '07', name: 'SYNTHESIA' },
  { id: '08', name: 'TRIBUNAL' },
  { id: '09', name: 'CRONOS' },
  { id: '10', name: 'FORGE' },
];

const sentinels = [
  { name: 'SEGURANÇA', state: 'ok' },
  { name: 'QUALIDADE', state: 'ok' },
  { name: 'POTÊNCIA ARC', state: 'ok' },
  { name: 'BEM-ESTAR', state: 'watch' },
];

const COMMANDS = ['/VAULT', '/HOLO', '/TERMINAL', '/FOCO [tema]', '/STATUS', '/SAIR'];

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
    <div style={{ ...display, fontSize: 26, color: C.text, fontWeight: 300, fontVariantNumeric: 'tabular-nums' }}>
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
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);

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

  // Vault Obsidian — vive no App para sobreviver às trocas de modo. Definido
  // antes do useChat porque a Captura automática de conversas (abaixo)
  // precisa de vault.writeCaptureNote/canWrite.
  const vault = useVault();

  const chat = useChat({
    startTimer,
    stopTimer,
    apiHistoryRef,
    speakChunks: speech.speakChunks,
    onPersistTurns: vault.canWrite ? vault.writeCaptureNote : null,
    searchMemory: vault.searchMemory,
  });

  // Quantas notas alimentam a memória de curto prazo nesta sessão — exibido
  // na cinta de estado, clicável desde a Etapa 6 pra abrir o MemoryPanel
  // (mesma contagem que vault.memoryDetail.notes, a fonte de verdade).
  const memoryNoteCount = vault.memoryDetail.notes.length;

  // Keep ref current on every render so STT callback always calls the latest submitCommand
  submitCommandRef.current = chat.submitCommand;

  // Fontes agora são self-hosted via index.html (public/fonts/) — sem injeção
  // de <link> em runtime, sem FOUT, sem origem third-party sob COEP.

  useEffect(() => {
    // Sob reduced-motion, o boot revela instantaneamente — o staging por
    // setTimeout é JS, então a regra CSS global de reduced-motion não o encurta.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setBootStage(5);
      return;
    }
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

  // Void reativo (Etapa 5 da auditoria): --jv-ambient no root, derivada do
  // mesmo estado real que já alimenta o Presence Core (+ falha de API).
  // Grade e streams leem essa única variável via CSS — nenhum elemento novo,
  // nenhum setInterval novo. Sob reduced-motion, congela em 0.30 (repouso).
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const ambient = reducedMotion ? 0.30
    : chat.apiError ? 0.20
    : (chat.toolStatus || chat.thinking) ? 0.85
    : speech.speaking ? 0.70
    : speech.listening ? 0.55
    : 0.30;

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
    <div className={chat.apiError ? 'jv-ambient-fail' : ''} style={{ ...mono, '--jv-ambient': ambient, background: `radial-gradient(ellipse at 50% 28%, ${C.bgSoft} 0%, ${C.bg} 55%, ${C.bgDeep} 100%)`, color: C.text, height: '100vh', width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
        @keyframes pulseSoft { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeInScale { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
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
        @keyframes pc-spin { to { transform: rotate(360deg); } }
        @keyframes pc-spin-rev { to { transform: rotate(-360deg); } }
        @keyframes pc-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes pc-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.14); opacity: 0.82; } }
        @keyframes pc-ripple { from { transform: scale(0.55); opacity: 0.5; } to { transform: scale(2.6); opacity: 0; } }
        @keyframes modeIn { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
        @keyframes bannerIn { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: translateY(0); } }
        .jv-mode-in { animation: modeIn 0.42s cubic-bezier(0.16,1,0.3,1) both; }
        .jv-banner-in { animation: bannerIn 0.32s cubic-bezier(0.16,1,0.3,1) both; }
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
        .jv-grain { position: fixed; inset: 0; pointer-events: none; z-index: 4; opacity: 0.025; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2' stitchTiles='stitch'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>"); }
        .jv-input::placeholder { color: ${C.quiet}; }
        .jv-input { caret-color: #00d4ff; }
        .jv-input:focus { outline: none; }
        /* Grade + vinheta (a máscara radial abaixo) reagem à mesma variável
           única --jv-ambient (Etapa 5) — void que respira com a máquina, sem
           elemento novo nem setInterval novo. */
        .jv-grid-bg { position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: var(--jv-ambient, 0.3); transition: opacity 900ms ease; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='115'><polygon points='50,2 98,26 98,74 50,98 2,74 2,26' fill='none' stroke='rgba(0,212,255,0.13)' stroke-width='0.8'/></svg>"); background-size: 100px 115px; animation: hexGlow 8s ease-in-out infinite; mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%); }
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
        /* Some em repouso/falha (ambient ≤ 0.30) — "apenas grade e vinheta" — e
           ganha corpo a partir de ouvindo. Mesma variável, mesma Etapa 5. */
        .jv-data-stream { position: fixed; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; opacity: calc((var(--jv-ambient, 0.3) - 0.3) * 2); transition: opacity 900ms ease; }
        /* Falha (chat.apiError): "void esfria, âmbar assume" — desvia o matiz
           ciano da grade/streams pro âmbar de C.warn, em vez de só apagar a
           mesma cor. Reaproveita a classe condicional do root, não é elemento
           novo nem outra variável — só um filtro CSS sobre os dois já existentes. */
        .jv-ambient-fail .jv-grid-bg, .jv-ambient-fail .jv-data-stream { filter: hue-rotate(-150deg) saturate(0.85); transition: filter 900ms ease; }
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
          .jv-data-stream, .jv-grid-bg { animation: none !important; }
        }
        /* ── Responsividade (Fase 4a) ──────────────────────────────────────
           Base = 3 colunas. <1280 esconde o rail direito (telemetria/sentinelas,
           informação secundária); <900 esconde também o esquerdo, deixando só o
           núcleo — conversa + voz + comando — que é sempre usável. Sem scroll
           horizontal em nenhuma largura. */
        .jv-layout { display: grid; grid-template-columns: 220px 1fr 240px; }
        .jv-term-scroll { padding: 36px 56px 150px 56px; }
        .jv-cmd { padding: 18px 32px 22px 32px; }
        @media (max-width: 1280px) {
          .jv-layout { grid-template-columns: 190px 1fr; }
          .jv-rail-right { display: none; }
          .jv-term-scroll { padding: 32px 36px 150px 36px; }
        }
        @media (max-width: 900px) {
          .jv-layout { grid-template-columns: 1fr; }
          .jv-rail-left { display: none; }
          .jv-header { flex-wrap: wrap; row-gap: 10px; padding: 12px 16px; }
          /* .jv-strip NÃO some aqui — vive fora dos rails de propósito: é o
             único instrumento (vault, memória, voz, contexto, latência) que
             sobrevive abaixo de 900px (achado P1 · MOBILE). */
          .jv-strip { padding: 0 16px; gap: 10px; }
          .jv-term-scroll { padding: 26px 18px 140px 18px; }
          .jv-cmd { padding: 16px 16px 18px 16px; }
        }
        @media (max-width: 620px) {
          .jv-hide-sm { display: none; }
          .jv-cmd-hints { display: none; }
        }
      `}</style>

      <div className="jv-grid-bg" />
      <div className="jv-grain" />
      {/* Streams: invisíveis em repouso ("apenas grade e vinheta"), aparecem a
          partir de ouvindo e aceleram até processando — via calc() sobre
          --jv-ambient, sem JS recomputando por tick. */}
      <div className="jv-data-stream">
        {[...Array(10)].map((_, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(i / 10) * 100 + (i % 3) * 2}%`, top: 0, width: 1, height: `${55 + (i % 4) * 35}px`, background: `linear-gradient(180deg, transparent, rgba(0,212,255,${0.25 + (i % 3) * 0.12}), transparent)`, animation: `dataStream calc(${5 + (i % 5) * 1.8}s * (0.3 / var(--jv-ambient, 0.3))) linear ${(i % 7) * 0.9}s infinite` }} />
        ))}
      </div>

      {/* TOP BAR */}
      <header className="jv-header" style={{ position: 'relative', zIndex: 10, borderBottom: `1px solid ${C.line}`, padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(5,10,20,0.94)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ ...display, fontSize: 22, fontWeight: 500, letterSpacing: '0.18em', color: C.text }}>STARK INDUSTRIES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.36em', textTransform: 'uppercase' }}>J.A.R.V.I.S. · Núcleo {MODEL.core}</div>
          </div>
          <div style={{ fontSize: 10, letterSpacing: '0.22em', color: C.ok, border: `1px solid ${C.ok}`, padding: '2px 7px', opacity: 0.85 }}>◉ ONLINE</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 22, rowGap: 8, justifyContent: 'flex-end', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.line}`, padding: 2 }}>
            <button onClick={() => setMode('terminal')} style={{ background: mode === 'terminal' ? C.accent : 'transparent', color: mode === 'terminal' ? C.bg : C.muted, border: 'none', padding: '4px 10px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: 'pointer' }}>TERMINAL</button>
            <button onClick={() => setMode('holographic')} style={{ background: mode === 'holographic' ? C.accent : 'transparent', color: mode === 'holographic' ? C.bg : C.muted, border: 'none', padding: '4px 10px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: 'pointer' }}>VAULT</button>
          </div>
          <VoiceIndicator voiceOut={speech.voiceOut} speaking={speech.speaking} listening={speech.listening} onToggle={speech.toggleVoiceOut} onPanel={() => speech.setVoicePanelOpen(o => !o)} supported={speech.speechSupported} />
          <div className="jv-hide-sm" style={{ color: C.muted }}>{fmtDate(time)}</div>
          <div style={{ color: C.text, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(time)} <span style={{ color: C.muted }}>brt</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Achado P0·1 (orçamento de pulso): pulsava enquanto ready — ou seja,
                sempre, depois do boot. O pulso é orçado pra transição real
                (iniciando); uma vez pronto, o núcleo fica aceso e parado. */}
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ready ? C.accent : C.warn }} className={!ready ? 'jv-pulse' : ''} />
            <span style={{ color: C.muted }}>{ready ? 'núcleo' : 'iniciando'}</span>
          </div>
        </div>
      </header>

      <StatusStrip
        vault={vault}
        memoryNoteCount={memoryNoteCount}
        onOpenMemory={() => setMemoryPanelOpen(o => !o)}
        focusMode={focusMode}
        speech={speech}
        contextPct={contextPct}
        subscribeLatency={subscribeLatency}
        getLatency={getLatency}
        indexStatus={vault.indexStatus}
        indexProgress={vault.indexProgress}
      />

      {/* MEMORY PANEL — inspetor só-leitura (Etapa 6), aberto pelo item
          MEMÓRIA da cinta */}
      {memoryPanelOpen && (
        <MemoryPanel detail={vault.memoryDetail} onClose={() => setMemoryPanelOpen(false)} />
      )}

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
          recogSupported={speech.recogSupported}
          apiError={chat.apiError}
          apiHistoryLength={apiHistoryRef.current.length / 2 | 0}
          onClearHistory={chat.clearHistory}
        />
      )}

      {/* BODY — flex:1 + minHeight:0 (mesmo idioma do <main> logo abaixo, App.jsx
          linha ~517) absorve exatamente o espaço que sobra da coluna flex do
          root, qualquer que seja a altura real de header+cinta+painel de voz.
          Antes disso era `calc(100vh - Npx)` com N fixo — hardcoded pro
          header sozinho (56px), ficou defasado quando a cinta de estado
          (Etapa 4, +28px) entrou, sobrando ~29-33px de conteúdo empurrado
          pra fora da viewport. Um número fixo sempre vai descalibrar de novo
          na próxima peça de chrome; isto elimina a classe inteira do bug. */}
      <div className="jv-layout" style={{ position: 'relative', zIndex: 10, flex: 1, minHeight: 0 }}>

        {/* LEFT RAIL */}
        <aside className="jv-rail-left" style={{ borderRight: `1px solid ${C.line}`, padding: '24px 18px', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 18 }}>SUBSISTEMAS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11 }}>
            {modules.map((m, i) => {
              // VAULT é o único subsistema com sinal vivo real (vault.status) — ponto
              // cheio, cor, pulso. Os outros nove são cenário: lore Stark sem dado por
              // trás, tratado como tal (tick fino estático, sem cor, sem animação) em
              // vez de fingir o mesmo grau de informação do sinal real.
              if (m.name !== 'VAULT') {
                return (
                  <div key={m.id} className="jv-fade" style={{ display: 'flex', alignItems: 'center', gap: 10, animationDelay: `${i * 80}ms` }}>
                    <span style={{ color: C.quiet, width: 18 }}>{m.id}</span>
                    <span style={{ color: C.muted, flex: 1, letterSpacing: '0.08em' }}>{m.name}</span>
                    <span style={{ width: 6, height: 1, background: C.dim }} />
                  </div>
                );
              }
              const on = vault.status === 'ready', scanning = vault.status === 'scanning';
              return (
                <div key={m.id} className="jv-fade" style={{ display: 'flex', alignItems: 'center', gap: 10, animationDelay: `${i * 80}ms` }}>
                  <span style={{ color: C.quiet, width: 18 }}>{m.id}</span>
                  <span style={{ color: on || scanning ? C.text : C.muted, flex: 1, letterSpacing: '0.08em' }}>{m.name}</span>
                  {/* Achado P0·1: pulsava em "ready" também — indefinidamente,
                      enquanto a pasta seguisse conectada. O pulso fica só pra
                      scanning (trabalho real em andamento); conectado e parado
                      vira ponto cheio, sem piscar. */}
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? C.accent : scanning ? C.warn : C.dim }} className={scanning ? 'jv-pulse' : ''} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 32, color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 14 }}>HIERARQUIA</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 10.5 }}>
            {[['T0','J.A.R.V.I.S.','1'],['T1','Stark (Sir)','1'],['T2','Agentes','5'],['T3','Subsistemas','12'],['T4','Sentinelas','4']].map(([tier, name, count]) => (
              <div key={tier} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ color: C.accentDim, width: 22, fontSize: 10, letterSpacing: '0.1em' }}>{tier}</span>
                <span style={{ color: C.muted, flex: 1 }}>{name}</span>
                <span style={{ color: C.quiet }}>{count}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 10 }}>CONTEXTO API</div>
            <div style={{ fontSize: 10, color: C.text }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.quiet }}>TURNOS</span>
                <span style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{Math.floor(apiHistoryRef.current.length / 2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.quiet }}>TOKENS EST.</span>
                <span style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{apiHistoryRef.current.reduce((a, m) => a + (m.content?.length || 0), 0) / 4 | 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.quiet }}>MODELO</span>
                <span style={{ color: C.accentDim, fontSize: 10 }}>{MODEL.label}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER */}
        <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
          {/* Banners: só eventos transitórios com ação disponível — estado
              persistente (foco, memória) foi pra cinta abaixo do header (Etapa
              4). Nunca mais de um por vez: falando tem prioridade sobre o flash
              de captura salva, porque oferece uma ação (silenciar) — captura
              salva é só informativa. */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, pointerEvents: 'none' }}>
            {speech.speaking ? (
              <div className="jv-banner-in" style={{ borderBottom: `1px solid ${C.lineStrong}`, padding: '8px 32px', background: 'rgba(3,7,16,0.96)', display: 'flex', alignItems: 'center', gap: 14, pointerEvents: 'auto' }}>
                <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', height: 14 }}>
                  {[14,14,14,14,14].map((h,i) => <span key={i} className="jv-wave-bar" style={{ height: h }} />)}
                </span>
                <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.3em' }}>J.A.R.V.I.S. · TRANSMITINDO</span>
                <button onClick={speech.stopSpeaking} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accentDim, padding: '3px 10px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: 'pointer' }}>◾ SILENCIAR</button>
              </div>
            ) : chat.captureSaved && (
              <div className="jv-banner-in" style={{ borderBottom: `1px solid ${C.lineStrong}`, padding: '8px 32px', background: 'rgba(3,7,16,0.96)', display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
                <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.3em' }}>💾 CONVERSA SALVA NO VAULT</span>
              </div>
            )}
          </div>

          {/* Troca de modo com fade (key={mode} remonta → dispara modeIn). */}
          <div key={mode} className="jv-mode-in" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {mode === 'terminal' ? (
              <TerminalView scrollRef={scrollRef} bootStage={bootStage} history={chat.history} thinking={chat.thinking} streamText={chat.streamText} toolStatus={chat.toolStatus} onOpenHud={chat.openHudMedia} />
            ) : (
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="jv-pulse" style={{ flex: 1, minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, letterSpacing: '0.32em', color: C.accent }}>
                    INICIALIZANDO NÚCLEO NEURAL…
                  </div>
                }>
                  <VaultBrain vault={vault} history={chat.history} thinking={chat.thinking} speaking={speech.speaking} listening={speech.listening} ready={ready} onAnalyzeNote={handleAnalyzeNote} />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          {/* COMMAND INPUT */}
          <div className="jv-cmd" style={{ borderTop: `1px solid ${C.line}`, background: 'rgba(5,10,20,0.92)', position: 'relative', zIndex: 20 }}>
            {/* Presence Core — hero flutuante ancorado logo acima do prompt.
                Só no modo terminal: no VAULT, o núcleo 3D é a outra projeção
                do mesmo ser (o handoff acontece no fade de troca de modo).
                pointer-events none → não bloqueia o texto atrás. */}
            {mode === 'terminal' && (
              <div className="jv-holo-in" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6, pointerEvents: 'none', zIndex: 15 }}>
                <PresenceCore size={116} thinking={chat.thinking} speaking={speech.speaking} listening={speech.listening} toolStatus={chat.toolStatus} />
              </div>
            )}
            {chat.apiError && (
              <div style={{ marginBottom: 10, fontSize: 10, color: C.critical, letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,60,60,0.08)', border: `1px solid ${C.critical}`, borderRadius: 4 }}>
                <div style={{ flex: 1 }}>
                  <div>⚠ {chat.apiError}</div>
                  {chat.showErrorDetails && chat.errorDetails && (
                    <div style={{ marginTop: 6, fontSize: 10, color: C.muted, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                      <div><strong>Tipo:</strong> {chat.errorDetails.type}</div>
                      <div><strong>Mensagem:</strong> {chat.errorDetails.fullMessage}</div>
                      {chat.errorDetails.stack && <div><strong>Stack:</strong> {chat.errorDetails.stack.split('\n')[0]}</div>}
                    </div>
                  )}
                </div>
                <button onClick={() => chat.setShowErrorDetails(!chat.showErrorDetails)} style={{ background: 'transparent', border: 'none', color: C.quiet, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>ℹ</button>
                {chat.lastFailedCmd && (
                  <button onClick={() => { chat.setApiError(null); chat.setErrorDetails(null); chat.setShowErrorDetails(false); chat.retryLastCommand(); }} style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, padding: '2px 8px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.18em', cursor: 'pointer', whiteSpace: 'nowrap' }}>↺ RETRY</button>
                )}
                <button onClick={() => { chat.setApiError(null); chat.setErrorDetails(null); chat.setShowErrorDetails(false); }} style={{ background: 'transparent', border: 'none', color: C.quiet, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
            {chat.activeBadge && (
              <div className="jv-fade" style={{ fontSize: 10, letterSpacing: '0.32em', color: C.accent, border: `1px solid ${C.accent}`, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>
                ◉ {chat.activeBadge}
              </div>
            )}
            {/* Cockpit: única superfície projetada da barra de comando (cantoneiras +
                glass legítimos aqui — é o que a regra de profundidade da Etapa 3/4
                reserva pra superfícies projetadas). O ícone de status tinha um
                gutter de 88px (herdando a largura do rótulo SIR · GABRIEL/
                J.A.R.V.I.S. da conversa acima, pra alinhar onde o texto digitado
                começa com onde o texto da conversa começa) — removido: reportado
                duas vezes como espaço morto (um glifo isolado nunca preenche
                88px, então sobra vazio de um lado ou do outro dele, não importa
                o alinhamento). O campo agora começa logo após o ícone; a
                alinhação com a conversa acima foi trocada por um cockpit sem
                buraco visível. */}
            <div style={{ position: 'relative', padding: '10px 16px', ...glass }}>
              <Corners />
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 10, gap: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', color: chat.thinking ? C.warn : C.accent, fontSize: 13 }}>{chat.thinking ? '⟳' : '⟢'}</span>
                <input
                  ref={inputRef}
                  className="jv-input"
                  disabled={!ready || chat.thinking}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={speech.partialTranscript ? 'ouvindo...' : speech.listening ? 'canal de voz aberto...' : speech.vadLoading ? 'inicializando VAD...' : chat.thinking ? 'processando na matrix neural...' : ready ? 'aguardando instrução, Sir...' : 'inicializando...'}
                  style={{ ...mono, flex: 1, minWidth: 140, background: 'transparent', border: 'none', color: C.text, fontSize: 14, letterSpacing: '0.02em', padding: '4px 0' }}
                />
                <MicButton listening={speech.listening} onStart={speech.startListening} onStop={speech.stopListening} disabled={!speech.recogSupported || chat.thinking || !ready || !!speech.partialTranscript || speech.vadLoading} />
                {!speech.recogSupported && (
                  <span title="Requer navegador Chromium com isolamento cross-origin (SharedArrayBuffer)" style={{ fontSize: 10, letterSpacing: '0.18em', color: C.quiet, whiteSpace: 'nowrap' }}>voz não suportada</span>
                )}
                <input ref={fileInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp,.json,.txt,.cube,.srt,.log,.csv,.md,.js,.py" onChange={handleFileSelect} />
                {/* Fantasma sempre — se há anexo, o chip abaixo do input já confirma;
                    ENVIAR é a única coisa preenchida da tela. */}
                <HudButton onClick={() => fileInputRef.current?.click()} disabled={!ready || chat.thinking} title="Anexar arquivo ou imagem">▸ ANEXO</HudButton>
                <HudButton onClick={handleSubmit} disabled={!ready || chat.thinking || !input.trim()} active={!!input.trim()}>▸ ENVIAR</HudButton>
              </div>
            </div>
            {speech.partialTranscript && (
              <div className="jv-fade" style={{ marginTop: 6, fontSize: 12, color: C.muted, letterSpacing: '0.04em', fontStyle: 'italic' }}>
                ◎ {speech.partialTranscript}
              </div>
            )}
            {attachment && (
              <div className="jv-fade" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: C.accentDim, letterSpacing: '0.08em', border: `1px solid ${C.line}`, padding: '5px 10px', width: 'fit-content' }}>
                <span>▸ {attachment.name} · {attachment.sizeLabel}</span>
                <button onClick={() => setAttachment(null)} style={{ background: 'transparent', border: 'none', color: C.quiet, cursor: 'pointer', fontSize: 11 }}>✕</button>
              </div>
            )}
            {attachmentError && (
              <div className="jv-fade" style={{ marginTop: 8, fontSize: 10, color: C.warn, letterSpacing: '0.08em' }}>
                ⚠ {attachmentError}
              </div>
            )}
            {/* Comandos como teclas — visíveis porque são a porta de entrada de tudo,
                não hints de 9,5px ilegíveis. "VOZ ATIVA" saiu daqui: é redundante
                com o caption do Presence Core, que já mostra OUVINDO/TRANSMITINDO. */}
            <div className="jv-cmd-hints" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, letterSpacing: '0.12em', flexWrap: 'wrap' }}>
              {COMMANDS.map(cmd => (
                <span key={cmd} style={{ border: `1px solid ${C.line}`, color: C.muted, padding: '3px 9px' }}>{cmd}</span>
              ))}
              <span style={{ color: C.accentDim, marginLeft: 4 }}>↵ tudo mais vai para a IA</span>
            </div>
          </div>
        </main>

        {/* RIGHT RAIL */}
        <aside className="jv-rail-right" style={{ borderLeft: `1px solid ${C.line}`, padding: '24px 20px', background: 'rgba(0,0,0,0.22)' }}>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 18 }}>TELEMETRIA</div>
          {/* CONTEXTO IA: turnos/20 é uma fração real (20 é o teto de truncamento
              de verdade, ver MAX_TURNS em api/chat.js) — segmentos nítidos, sem ≈. */}
          <Meter label="CONTEXTO IA" value={contextPct} unit="%" />
          {/* TOKENS SESSÃO: a contagem é real (soma do usage da API), mas não
              existe orçamento real de 100k por sessão — é só escala visual. Modo
              contínuo + "≈" deixam isso explícito em vez de fingir precisão. */}
          <Meter label="TOKENS SESSÃO" value={sessionTokens} max={100000} display={`${sessionTokens.toLocaleString('pt-BR')} tk`} continuous />
          <div style={{ marginTop: 16, marginBottom: 22 }}>
            <div style={{ fontSize: 10, color: C.quiet, letterSpacing: '0.28em', marginBottom: 6 }}>LATÊNCIA API</div>
            <LatencyReadout subscribe={subscribeLatency} getInitial={getLatency} />
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 20, marginBottom: 22 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 14 }}>SENTINELAS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11 }}>
              {/* Sem fonte de dado real por trás (array estático) — cenário, não
                  sinal: tick fino, sem cor, sem pulso. Ver subsistemas acima. */}
              {sentinels.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 6, height: 1, background: C.dim }} />
                  <span style={{ color: C.muted, flex: 1, letterSpacing: '0.06em' }}>{s.name}</span>
                  <span style={{ color: C.quiet, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em' }}>{s.state}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 18 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 8 }}>OPERADOR</div>
            <div style={{ ...display, color: C.accent, fontSize: 11, fontWeight: 500, letterSpacing: '0.28em' }}>SIR · GABRIEL</div>
            <div style={{ ...display, color: C.text, fontSize: 18, marginTop: 2 }}>Schoenardie</div>
            <div style={{ fontSize: 10, color: C.quiet, marginTop: 4, letterSpacing: '0.12em' }}>engenharia de vídeo · cinema</div>
            <div style={{ marginTop: 14, fontSize: 10, color: C.accentDim, letterSpacing: '0.16em' }}>Canoas · BRT -3</div>
          </div>
        </aside>
      </div>

      <HudMediaWindow media={chat.hudMedia} onClose={chat.closeHudMedia} />
    </div>
  );
}
