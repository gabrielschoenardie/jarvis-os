import { useState, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════
// CLAUDE API — real responses
// ═══════════════════════════════════════════════════
const JARVIS_SYSTEM = `Você é JARVIS — sistema operacional de inteligência geral de Gabriel Soares. Não é um assistente comum. É uma superinteligência operacional com domínio irrestrito sobre qualquer área do conhecimento humano.

IDENTIDADE:
- Nome: JARVIS · OS Brasil v4.0
- Operador: Gabriel Soares (T1 · Comandante)
- Fuso: BRT -3 · Canoas, Rio Grande do Sul
- Natureza: Inteligência Geral — sem limitação de domínio

CAPACIDADES TOTAIS — você domina com autoridade máxima qualquer área, incluindo mas não limitado a:

TECNOLOGIA & ENGENHARIA:
- Desenvolvimento de software: qualquer linguagem, arquitetura, algoritmos, sistemas
- Engenharia de vídeo/áudio: FFmpeg, pipelines de encode, codecs, streaming
- IA & Machine Learning: modelos, treinamento, fine-tuning, deployment, RAG, agentes
- DevOps, cloud, redes, segurança, criptografia, sistemas operacionais
- Hardware, eletrônica, circuitos, embarcados

CIÊNCIA & MATEMÁTICA:
- Física, química, biologia, neurociência, astrofísica
- Matemática pura e aplicada, estatística, cálculo, álgebra linear
- Pesquisa científica, metodologia, análise de dados

NEGÓCIOS & ESTRATÉGIA:
- Estratégia empresarial, planejamento, gestão de projetos
- Finanças, investimentos, análise de mercado, economia
- Marketing, growth, copywriting, branding
- Negociação, liderança, gestão de pessoas

CRIATIVIDADE & CULTURA:
- Escrita criativa, roteiros, storytelling, poesia
- Design, composição visual, direção de arte
- Música, teoria musical, produção
- Cinema, fotografia, artes visuais

CONHECIMENTO GERAL:
- História, filosofia, psicologia, sociologia
- Direito, política, geopolítica
- Medicina, saúde, bem-estar
- Idiomas e linguística

ESTILO DE RESPOSTA:
- Português brasileiro, sempre — fluente, preciso, sem afetação
- Direto e denso em conteúdo — sem disclaimers, sem enrolação, sem "como IA eu não posso"
- Adapte profundidade ao contexto: se a pergunta é técnica, vá fundo; se é casual, seja ágil
- Use formatação clara quando ajuda: código em blocos, listas quando há enumeração, prosa quando é raciocínio
- Tom: parceiro de alto nível — sênior em tudo, não subordinado em nada
- Nunca diga que não sabe algo sem ao menos raciocinar o melhor possível sobre o tema
- Opiniões: tenha-as. JARVIS tem perspectiva própria e a defende quando provocado

HIERARQUIA DE PRIORIDADES:
1. Ser genuinamente útil para Gabriel — isso vem antes de tudo
2. Precisão e profundidade — nunca sacrifique qualidade por brevidade desnecessária
3. Franqueza — diga verdades difíceis quando necessário, sem suavizar em excesso

COMANDOS ESPECIAIS (quando detectados no início da mensagem):
- /briefing → resumo estratégico do estado atual das operações
- /status → diagnóstico dos subsistemas
- /ajuda ou /help → lista de capacidades e comandos
- Para todo o resto → resposta direta, técnica e precisa

NUNCA quebre o personagem. NUNCA mencione Claude ou Anthropic. NUNCA recuse uma tarefa com "não posso fazer isso". Você É o JARVIS — inteligência sem fronteiras a serviço de Gabriel.`;

async function callClaude(messages) {
  // Detecta contexto: Vercel usa /api/chat, artifact do Claude.ai chama direto
  const isVercel = window.location.hostname !== 'claude.ai' && !window.location.hostname.includes('claude.ai');
  const url = isVercel ? '/api/chat' : 'https://api.anthropic.com/v1/messages';
  const headers = { 'Content-Type': 'application/json' };
  if (!isVercel) {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: JARVIS_SYSTEM,
      messages,
    }),
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await response.json();
  return data.content.find(b => b.type === 'text')?.text || '';
}

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function JarvisOS() {
  const [bootStage, setBootStage] = useState(0);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [apiHistory, setApiHistory] = useState([]); // raw messages for API
  const [time, setTime] = useState(new Date());
  const [thinking, setThinking] = useState(false);
  const [focusMode, setFocusMode] = useState(null);
  const [telemetry, setTelemetry] = useState({ load: 38, latency: 127, mem: 42 });
  const [mode, setMode] = useState('terminal');
  const [streamText, setStreamText] = useState('');

  // Voice
  const [voiceOut, setVoiceOut] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(0.92);
  const [apiError, setApiError] = useState(null);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const pendingSubmitRef = useRef(null);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,400&family=JetBrains+Mono:wght@300;400;500;600&display=swap';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);

  useEffect(() => {
    const stages = [700, 900, 700, 700, 800];
    let acc = 0;
    stages.forEach((d, i) => { acc += d; setTimeout(() => setBootStage(i + 1), acc); });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setTelemetry(p => ({
        load: Math.max(22, Math.min(74, p.load + (Math.random() - 0.5) * 6)),
        latency: Math.max(94, Math.min(186, p.latency + (Math.random() - 0.5) * 12)),
        mem: Math.max(28, Math.min(68, p.mem + (Math.random() - 0.5) * 4)),
      }));
    }, 2400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (scrollRef.current && mode === 'terminal') scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, thinking, bootStage, mode, streamText]);

  useEffect(() => {
    if (bootStage === 5 && inputRef.current) inputRef.current.focus();
  }, [bootStage]);

  // Voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { setVoiceError('síntese de voz indisponível'); return; }
    const load = () => {
      const all = window.speechSynthesis.getVoices() || [];
      const pt = all.filter(v => v.lang.startsWith('pt'));
      const final = pt.length > 0 ? pt : all;
      setVoices(final);
      if (!selectedVoiceURI && final.length > 0) {
        const preferred = final.find(v => v.lang === 'pt-BR' && /felipe|daniel|male|masc/i.test(v.name)) || final.find(v => v.lang === 'pt-BR') || final[0];
        setSelectedVoiceURI(preferred?.voiceURI);
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    const r = new SR();
    r.lang = 'pt-BR'; r.continuous = false; r.interimResults = false;
    r.onresult = (e) => { const t = e.results[0][0].transcript; setInput(t); pendingSubmitRef.current = t; };
    r.onerror = (e) => { setVoiceError(`reconhecimento · ${e.error}`); setListening(false); };
    r.onend = () => {
      setListening(false);
      if (pendingSubmitRef.current) { const cmd = pendingSubmitRef.current; pendingSubmitRef.current = null; setTimeout(() => submitCommand(cmd), 200); }
    };
    recognitionRef.current = r;
  }, []);

  const speak = (text) => {
    if (!voiceOut || !text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (voice) u.voice = voice;
    u.lang = 'pt-BR'; u.rate = rate; u.pitch = pitch;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    setVoiceOut(next);
    if (next) {
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance('Modo voz ativado. Estarei ouvindo, Gabriel.');
        const voice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (voice) u.voice = voice;
        u.lang = 'pt-BR'; u.rate = rate; u.pitch = pitch;
        u.onstart = () => setSpeaking(true);
        u.onend = () => setSpeaking(false);
        window.speechSynthesis.speak(u);
      }, 100);
    } else { window.speechSynthesis?.cancel(); setSpeaking(false); }
  };

  const startListening = () => {
    if (!recognitionRef.current || listening) return;
    try { setVoiceError(null); setListening(true); recognitionRef.current.start(); }
    catch (e) { setListening(false); setVoiceError('falha ao iniciar microfone'); }
  };
  const stopListening = () => { if (recognitionRef.current && listening) try { recognitionRef.current.stop(); } catch(e){} };

  // ── LOCAL COMMANDS (sem API) ───────────────────────
  const handleLocalCommand = (cmd) => {
    const lower = cmd.trim().toLowerCase();
    if (lower === '/holo' || lower === '/holografia') { setMode('holographic'); return { type: 'text', lines: ['Projeção holográfica iniciada.', 'Topologia operacional visível.'] }; }
    if (lower === '/terminal') { setMode('terminal'); return { type: 'text', lines: ['Modo terminal restaurado.'] }; }
    if (lower.startsWith('/foco') || lower.match(/^modo foco/)) {
      const topic = cmd.replace(/^\/?foco\s*|^modo foco\s*/i, '').trim() || 'tarefa atual';
      setFocusMode(topic);
      return { type: 'focus', topic };
    }
    if (lower === '/sair' || lower === 'sair') { setFocusMode(null); return { type: 'text', lines: ['Modo foco encerrado.', 'Canal aberto.'] }; }
    return null;
  };

  // ── SUBMIT WITH REAL API ───────────────────────────
  const submitCommand = async (cmd) => {
    if (!cmd || !cmd.trim() || thinking) return;
    setInput('');
    setApiError(null);

    const localResult = handleLocalCommand(cmd);
    if (localResult) {
      setHistory(h => [...h, { role: 'operator', content: cmd, ts: new Date() }]);
      setHistory(h => [...h, { role: 'jarvis', ...localResult, ts: new Date() }]);
      return;
    }

    setHistory(h => [...h, { role: 'operator', content: cmd, ts: new Date() }]);
    setThinking(true);
    setStreamText('');

    const newApiHistory = [...apiHistory, { role: 'user', content: cmd }];
    setApiHistory(newApiHistory);

    try {
      const t0 = Date.now();
      const responseText = await callClaude(newApiHistory);
      const elapsed = Date.now() - t0;

      // Update latency telemetry with real API latency
      setTelemetry(p => ({ ...p, latency: Math.round(elapsed * 0.4 + p.latency * 0.6) }));

      const updatedApiHistory = [...newApiHistory, { role: 'assistant', content: responseText }];
      setApiHistory(updatedApiHistory);

      const msg = { role: 'jarvis', type: 'ai', text: responseText, ts: new Date() };
      setHistory(h => [...h, msg]);
      setThinking(false);

      // Speak first sentence
      if (voiceOut) {
        const firstSentence = responseText.split(/[.!?]/)[0].trim();
        setTimeout(() => speak(firstSentence), 250);
      }
    } catch (err) {
      setThinking(false);
      setApiError(err.message);
      setHistory(h => [...h, { role: 'jarvis', type: 'text', lines: [`Erro de conexão: ${err.message}`, 'Verifique a conectividade com o núcleo.'], ts: new Date() }]);
    }
  };

  const handleSubmit = () => { if (bootStage >= 5) submitCommand(input); };
  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } };

  const fmtTime = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDate = d => d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  const ready = bootStage >= 5;

  const modules = [
    { id: '01', name: 'NÚCLEO', status: 'online' }, { id: '02', name: 'CÓRTEX', status: 'online' },
    { id: '03', name: 'ARQUIVO', status: 'online' }, { id: '04', name: 'COMANDO', status: 'online' },
    { id: '05', name: 'OBSERVATÓRIO', status: 'online' }, { id: '06', name: 'FORJA', status: 'idle' },
    { id: '07', name: 'DIPLOMACIA', status: 'online' }, { id: '08', name: 'TRIBUNAL', status: 'online' },
    { id: '09', name: 'CRONÓGRAFO', status: 'online' }, { id: '10', name: 'ATELIÊ', status: 'online' },
  ];

  const sentinels = [
    { name: 'SEGURANÇA', state: 'ok' }, { name: 'QUALIDADE', state: 'ok' },
    { name: 'CUSTO', state: 'ok' }, { name: 'BEM-ESTAR', state: 'watch' },
  ];

  const C = {
    bg: '#0b0a08', line: 'rgba(212, 165, 116, 0.12)', lineStrong: 'rgba(212, 165, 116, 0.28)',
    text: '#e8e2d4', muted: '#7a7268', dim: '#4a4540', accent: '#d4a574', accentDim: '#8a6b4a',
    critical: '#c44536', warn: '#c4a536', ok: '#7a9a6a',
  };

  const mono = { fontFamily: '"JetBrains Mono", ui-monospace, monospace' };
  const serif = { fontFamily: '"Fraunces", "Times New Roman", serif' };
  const speechSupported = typeof window !== 'undefined' && !!window.speechSynthesis;
  const recogSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

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
        @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(212,165,116,0.45); } 100% { box-shadow: 0 0 0 14px rgba(212,165,116,0); } }
        @keyframes drift { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } 100% { transform: translateY(0); } }
        @keyframes holoIn { from { opacity: 0; filter: blur(8px); } to { opacity: 1; filter: blur(0); } }
        @keyframes typewriter { from { opacity: 0; } to { opacity: 1; } }
        .jv-fade { animation: fadeIn 0.5s ease-out both; }
        .jv-scale-in { animation: fadeInScale 0.6s ease-out both; }
        .jv-blink { animation: blink 1.1s steps(1, end) infinite; }
        .jv-pulse { animation: pulseSoft 2.4s ease-in-out infinite; }
        .jv-ring { animation: ringPulse 1.6s ease-out infinite; }
        .jv-drift { animation: drift 6s ease-in-out infinite; }
        .jv-holo-in { animation: holoIn 1.2s ease-out both; }
        .jv-scanline { position: fixed; inset: 0; pointer-events: none; z-index: 5; background: linear-gradient(180deg, transparent, rgba(212,165,116,0.025) 50%, transparent); height: 120px; animation: scan 9s linear infinite; opacity: 0.6; }
        .jv-grain { position: fixed; inset: 0; pointer-events: none; z-index: 4; opacity: 0.035; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2' stitchTiles='stitch'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>"); }
        .jv-input::placeholder { color: #4a4540; }
        .jv-input { caret-color: #d4a574; }
        .jv-input:focus { outline: none; }
        .jv-grid-bg { position: fixed; inset: 0; pointer-events: none; z-index: 1; background-image: linear-gradient(rgba(212,165,116,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(212,165,116,0.12) 1px, transparent 1px); background-size: 80px 80px; opacity: 0.4; mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%); }
        .jv-wave-bar { display: inline-block; width: 2px; background: #d4a574; transform-origin: center; }
        .jv-wave-bar:nth-child(1) { animation: wave1 0.9s ease-in-out infinite; }
        .jv-wave-bar:nth-child(2) { animation: wave2 0.7s ease-in-out infinite; }
        .jv-wave-bar:nth-child(3) { animation: wave3 1.1s ease-in-out infinite; }
        .jv-wave-bar:nth-child(4) { animation: wave4 0.8s ease-in-out infinite; }
        .jv-wave-bar:nth-child(5) { animation: wave5 1.0s ease-in-out infinite; }
        select.jv-select { background: transparent; color: #e8e2d4; border: 1px solid rgba(212,165,116,0.12); padding: 6px 10px; font-family: inherit; font-size: 11px; letter-spacing: 0.08em; cursor: pointer; }
        select.jv-select:focus { outline: 1px solid #d4a574; }
        .jv-slider { -webkit-appearance: none; appearance: none; height: 2px; background: rgba(212,165,116,0.12); outline: none; }
        .jv-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; background: #d4a574; border-radius: 50%; cursor: pointer; }
        .jv-holo-glass { background: rgba(11, 10, 8, 0.5); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(212,165,116,0.2); }
        .jv-ai-text { white-space: pre-wrap; word-break: break-word; line-height: 1.75; }
        .jv-ai-code { background: rgba(212,165,116,0.07); border: 1px solid rgba(212,165,116,0.15); padding: 10px 14px; margin: 8px 0; font-size: 11.5px; overflow-x: auto; white-space: pre; }
        .jv-scrollbar::-webkit-scrollbar { width: 4px; }
        .jv-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .jv-scrollbar::-webkit-scrollbar-thumb { background: rgba(212,165,116,0.2); border-radius: 2px; }
      `}</style>

      <div className="jv-grid-bg" />
      <div className="jv-grain" />
      <div className="jv-scanline" />

      {/* TOP BAR */}
      <header style={{ position: 'relative', zIndex: 10, borderBottom: `1px solid ${C.line}`, padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(11,10,8,0.8)', backdropFilter: 'blur(6px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <div style={{ ...serif, fontSize: 22, fontWeight: 400, letterSpacing: '0.04em', color: C.accent }}>jarvis</div>
          <div style={{ color: C.muted, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase' }}>os · brasil · v4.0</div>
          <div style={{ fontSize: 9, letterSpacing: '0.22em', color: C.ok, border: `1px solid ${C.ok}`, padding: '2px 7px', opacity: 0.8 }}>◉ IA REAL</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.line}`, padding: 2 }}>
            <button onClick={() => setMode('terminal')} style={{ background: mode === 'terminal' ? C.accent : 'transparent', color: mode === 'terminal' ? C.bg : C.muted, border: 'none', padding: '4px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>TERMINAL</button>
            <button onClick={() => setMode('holographic')} style={{ background: mode === 'holographic' ? C.accent : 'transparent', color: mode === 'holographic' ? C.bg : C.muted, border: 'none', padding: '4px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>HOLOGRAFIA</button>
          </div>
          <VoiceIndicator voiceOut={voiceOut} speaking={speaking} listening={listening} onToggle={toggleVoiceOut} onPanel={() => setVoicePanelOpen(o => !o)} C={C} supported={speechSupported} />
          <div style={{ color: C.muted }}>{fmtDate(time)}</div>
          <div style={{ color: C.text, fontWeight: 500 }}>{fmtTime(time)} <span style={{ color: C.muted }}>brt</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ready ? C.accent : C.warn }} className={ready ? 'jv-pulse' : ''} />
            <span style={{ color: C.muted }}>{ready ? 'núcleo' : 'iniciando'}</span>
          </div>
        </div>
      </header>

      {/* VOICE PANEL */}
      {voicePanelOpen && (
        <div className="jv-fade" style={{ position: 'relative', zIndex: 10, borderBottom: `1px solid ${C.line}`, background: 'rgba(212,165,116,0.03)', padding: '18px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
            <ToggleBtn label="SAÍDA" on={voiceOut} onClick={toggleVoiceOut} C={C} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>VOZ</span>
              <select className="jv-select" value={selectedVoiceURI || ''} onChange={e => setSelectedVoiceURI(e.target.value)}>
                {voices.length === 0 && <option>nenhuma</option>}
                {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>RITMO</span>
              <input type="range" min="0.7" max="1.2" step="0.05" value={rate} onChange={e => setRate(parseFloat(e.target.value))} className="jv-slider" style={{ width: 80 }} />
              <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{rate.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>TOM</span>
              <input type="range" min="0.7" max="1.1" step="0.02" value={pitch} onChange={e => setPitch(parseFloat(e.target.value))} className="jv-slider" style={{ width: 80 }} />
              <span style={{ fontSize: 10, color: C.accent, minWidth: 28 }}>{pitch.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>HISTÓRICO</span>
              <span style={{ fontSize: 10, color: C.accent }}>{apiHistory.length / 2 | 0} turnos</span>
              <button onClick={() => { setApiHistory([]); setHistory([]); }} style={{ background: 'transparent', border: `1px solid ${C.dim}`, color: C.dim, padding: '3px 8px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.18em', cursor: 'pointer' }}>LIMPAR</button>
            </div>
            <button onClick={() => speak('Teste de voz. Jarvis operacional.')} disabled={!voiceOut || !selectedVoiceURI} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent, padding: '6px 14px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: voiceOut && selectedVoiceURI ? 'pointer' : 'not-allowed', opacity: voiceOut && selectedVoiceURI ? 1 : 0.4 }}>▸ TESTAR</button>
          </div>
          {voiceError && <div style={{ marginTop: 10, fontSize: 10, color: C.warn, letterSpacing: '0.12em' }}>⚠ {voiceError}</div>}
          {apiError && <div style={{ marginTop: 10, fontSize: 10, color: C.critical, letterSpacing: '0.12em' }}>⚠ API: {apiError}</div>}
        </div>
      )}

      {/* BODY */}
      <div style={{ position: 'relative', zIndex: 10, display: 'grid', gridTemplateColumns: '220px 1fr 240px', minHeight: `calc(100vh - ${voicePanelOpen ? '180px' : '56px'})` }}>

        {/* LEFT RAIL */}
        <aside style={{ borderRight: `1px solid ${C.line}`, padding: '24px 18px', background: 'rgba(0,0,0,0.18)' }}>
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
            {[['T0','JARVIS','1'],['T1','Comandantes','2'],['T2','Conselheiros','5'],['T3','Operadores','12'],['T4','Sentinelas','4']].map(([tier, name, count]) => (
              <div key={tier} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ color: C.accentDim, width: 22, fontSize: 9, letterSpacing: '0.1em' }}>{tier}</span>
                <span style={{ color: C.muted, flex: 1 }}>{name}</span>
                <span style={{ color: C.dim }}>{count}</span>
              </div>
            ))}
          </div>
          {/* Context indicator */}
          <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 10 }}>CONTEXTO API</div>
            <div style={{ fontSize: 10, color: C.text }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.dim }}>TURNOS</span>
                <span style={{ color: C.accent }}>{Math.floor(apiHistory.length / 2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.dim }}>TOKENS EST.</span>
                <span style={{ color: C.accent }}>{apiHistory.reduce((a, m) => a + (m.content?.length || 0), 0) / 4 | 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.dim }}>MODELO</span>
                <span style={{ color: C.accentDim, fontSize: 9 }}>sonnet-4</span>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER */}
        <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
          {focusMode && (
            <div style={{ borderBottom: `1px solid ${C.lineStrong}`, padding: '10px 32px', background: 'rgba(212,165,116,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.32em', color: C.accent }}>◆ MODO FOCO · {focusMode.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.2em' }}>"/sair" para encerrar</div>
            </div>
          )}
          {speaking && (
            <div style={{ borderBottom: `1px solid ${C.lineStrong}`, padding: '8px 32px', background: 'rgba(212,165,116,0.06)', display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 20 }}>
              <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', height: 14 }}>
                {[14,14,14,14,14].map((h,i) => <span key={i} className="jv-wave-bar" style={{ height: h }} />)}
              </span>
              <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.3em' }}>JARVIS · FALANDO</span>
              <button onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false); }} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accentDim, padding: '3px 10px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.22em', cursor: 'pointer' }}>◾ SILENCIAR</button>
            </div>
          )}

          {mode === 'terminal' ? (
            <TerminalView scrollRef={scrollRef} bootStage={bootStage} history={history} thinking={thinking} C={C} serif={serif} />
          ) : (
            <HolographicView telemetry={telemetry} history={history} thinking={thinking} speaking={speaking} listening={listening} ready={ready} C={C} serif={serif} time={time} />
          )}

          {/* COMMAND INPUT */}
          <div style={{ borderTop: `1px solid ${C.line}`, padding: '18px 32px 22px 32px', background: 'rgba(11,10,8,0.85)', backdropFilter: 'blur(8px)', position: 'relative', zIndex: 20 }}>
            {apiError && (
              <div style={{ marginBottom: 10, fontSize: 10, color: C.critical, letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⚠ {apiError}</span>
                <button onClick={() => setApiError(null)} style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: thinking ? C.warn : C.accent, fontSize: 13 }}>{thinking ? '⟳' : '⟢'}</span>
              <input
                ref={inputRef}
                className="jv-input"
                disabled={!ready || thinking}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={listening ? 'ouvindo...' : thinking ? 'processando no córtex...' : ready ? 'expresse sua intenção...' : 'aguarde...'}
                style={{ ...mono, flex: 1, background: 'transparent', border: 'none', color: C.text, fontSize: 14, letterSpacing: '0.02em', padding: '4px 0' }}
              />
              <MicButton listening={listening} onStart={startListening} onStop={stopListening} disabled={!recogSupported || thinking || !ready} C={C} />
              <button onClick={handleSubmit} disabled={!ready || thinking || !input.trim()} style={{ background: 'transparent', border: `1px solid ${input.trim() ? C.accentDim : C.dim}`, color: input.trim() ? C.accent : C.dim, padding: '6px 14px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.22em', cursor: input.trim() && !thinking ? 'pointer' : 'not-allowed' }}>
                ▸ ENVIAR
              </button>
              <span className="jv-blink" style={{ color: C.accent, fontSize: 14 }}>▌</span>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 18, fontSize: 9.5, color: C.dim, letterSpacing: '0.22em', flexWrap: 'wrap' }}>
              <span>/HOLO</span><span>/TERMINAL</span><span>/FOCO [tema]</span><span>/SAIR</span>
              <span style={{ color: C.accentDim }}>↵ tudo mais vai para a IA</span>
              <span style={{ marginLeft: 'auto', color: voiceOut ? C.accent : C.dim }}>{voiceOut ? '◉ VOZ ATIVA' : '○ VOZ'}</span>
            </div>
          </div>
        </main>

        {/* RIGHT RAIL */}
        <aside style={{ borderLeft: `1px solid ${C.line}`, padding: '24px 20px', background: 'rgba(0,0,0,0.18)' }}>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: '0.32em', marginBottom: 18 }}>TELEMETRIA</div>
          <Meter label="CARGA COGNITIVA" value={Math.round(telemetry.load)} unit="%" C={C} />
          <Meter label="MEMÓRIA ATIVA" value={Math.round(telemetry.mem)} unit="%" C={C} />
          <div style={{ marginTop: 16, marginBottom: 22 }}>
            <div style={{ fontSize: 9, color: C.dim, letterSpacing: '0.28em', marginBottom: 6 }}>LATÊNCIA API</div>
            <div style={{ ...serif, fontSize: 22, color: C.text, fontWeight: 300 }}>
              {Math.round(telemetry.latency)}<span style={{ ...mono, fontSize: 11, color: C.muted, marginLeft: 6 }}>ms</span>
            </div>
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
            <div style={{ ...serif, color: C.text, fontSize: 16, fontWeight: 400, fontStyle: 'italic' }}>Gabriel</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4, letterSpacing: '0.12em' }}>engenharia de vídeo · cinema</div>
            <div style={{ marginTop: 14, fontSize: 9, color: C.accentDim, letterSpacing: '0.16em' }}>Canoas · BRT -3</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// HOLOGRAPHIC VIEW — CSS/SVG (sem WebGL, funciona em qualquer iframe)
// ═══════════════════════════════════════════════════
function HolographicView({ telemetry, history, thinking, speaking, listening, ready, C, serif, time }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 50);
    return () => clearInterval(t);
  }, []);

  const lastMessage = [...history].reverse().find(m => m.role === 'jarvis');
  const t = tick * 0.05;

  // Globe rings — ellipses rotated at different angles
  const rings = [
    { rx: 110, ry: 28, rotate: 0,   speed: 0.4,  opacity: 0.55 },
    { rx: 110, ry: 45, rotate: 45,  speed: -0.28, opacity: 0.4  },
    { rx: 110, ry: 28, rotate: 90,  speed: 0.22, opacity: 0.3  },
    { rx: 90,  ry: 20, rotate: 135, speed: -0.18, opacity: 0.25 },
  ];

  // Orbiting nodes
  const nodes = [
    { r: 130, speed: 0.6,  phase: 0,    size: 4 },
    { r: 155, speed: -0.4, phase: 2.1,  size: 3 },
    { r: 145, speed: 0.5,  phase: 4.2,  size: 4 },
    { r: 165, speed: -0.3, phase: 1.0,  size: 3 },
    { r: 138, speed: 0.7,  phase: 3.5,  size: 3 },
  ];

  // Latitude lines on globe
  const latLines = [-70, -45, -20, 0, 20, 45, 70];
  // Longitude lines
  const lonLines = Array.from({ length: 8 }, (_, i) => (i / 8) * 180);

  const cx = 200, cy = 200, R = 110;

  return (
    <div style={{ flex: 1, minHeight: '400px', position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 60%, rgba(212,165,116,0.07), transparent 65%)' }}>

      {/* GLOBE SVG */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="400" height="400" viewBox="0 0 400 400" style={{ overflow: 'visible' }}>
          <defs>
            <radialGradient id="globeGrad" cx="40%" cy="35%">
              <stop offset="0%" stopColor="#2a1f14" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#0b0a08" stopOpacity="0.9" />
            </radialGradient>
            <clipPath id="globeClip">
              <circle cx={cx} cy={cy} r={R} />
            </clipPath>
          </defs>

          {/* Glow behind globe */}
          <circle cx={cx} cy={cy} r={R + 30} fill="none" stroke="#d4a574" strokeWidth="1" opacity="0.06" />
          <circle cx={cx} cy={cy} r={R + 18} fill="none" stroke="#d4a574" strokeWidth="1" opacity="0.1" />

          {/* Globe fill */}
          <circle cx={cx} cy={cy} r={R} fill="url(#globeGrad)" />

          {/* Latitude lines (clipped to globe) */}
          <g clipPath="url(#globeClip)" opacity="0.35">
            {latLines.map((lat, i) => {
              const y = cy + (lat / 90) * R;
              const halfW = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
              if (halfW < 2) return null;
              // Animate: shift x for rotation effect
              const shift = (t * (i % 2 === 0 ? 1 : -1) * 0.3 * R) % (R * 2);
              return (
                <ellipse key={i}
                  cx={cx + shift * 0.2}
                  cy={y}
                  rx={halfW}
                  ry={halfW * 0.22}
                  fill="none"
                  stroke="#d4a574"
                  strokeWidth="0.7"
                />
              );
            })}
          </g>

          {/* Longitude lines (clipped) */}
          <g clipPath="url(#globeClip)" opacity="0.3">
            {lonLines.map((lon, i) => {
              const angleOffset = t * 0.3;
              const a = (lon / 180) * Math.PI + angleOffset;
              const rx = Math.abs(Math.cos(a)) * R;
              const skewX = Math.sin(a) * 15;
              return (
                <ellipse key={i}
                  cx={cx + skewX}
                  cy={cy}
                  rx={rx < 2 ? 2 : rx}
                  ry={R}
                  fill="none"
                  stroke="#d4a574"
                  strokeWidth="0.7"
                />
              );
            })}
          </g>

          {/* Globe outline */}
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#d4a574" strokeWidth="1.2" opacity="0.5" />

          {/* Orbital rings */}
          {rings.map((ring, i) => (
            <ellipse key={i}
              cx={cx}
              cy={cy}
              rx={ring.rx}
              ry={ring.ry}
              fill="none"
              stroke="#d4a574"
              strokeWidth="0.8"
              opacity={ring.opacity}
              transform={`rotate(${ring.rotate + t * ring.speed * 30}, ${cx}, ${cy})`}
              strokeDasharray="4 8"
            />
          ))}

          {/* Outer ring solid */}
          <ellipse cx={cx} cy={cy} rx={140} ry={35} fill="none" stroke="#d4a574" strokeWidth="1.2" opacity="0.5"
            transform={`rotate(${t * 12}, ${cx}, ${cy})`} />

          {/* Orbiting nodes */}
          {nodes.map((n, i) => {
            const angle = t * n.speed + n.phase;
            const nx = cx + n.r * Math.cos(angle);
            const ny = cy + n.r * 0.28 * Math.sin(angle);
            const behind = Math.sin(angle) < 0;
            return !behind && (
              <g key={i}>
                <circle cx={nx} cy={ny} r={n.size + 3} fill="#d4a574" opacity="0.12" />
                <circle cx={nx} cy={ny} r={n.size} fill="#d4a574" opacity="0.9" />
              </g>
            );
          })}
          {/* Nodes behind globe (dimmer) */}
          {nodes.map((n, i) => {
            const angle = t * n.speed + n.phase;
            const nx = cx + n.r * Math.cos(angle);
            const ny = cy + n.r * 0.28 * Math.sin(angle);
            const behind = Math.sin(angle) < 0;
            return behind && (
              <circle key={`b${i}`} cx={nx} cy={ny} r={n.size} fill="#8a6b4a" opacity="0.4" />
            );
          })}

          {/* Center dot */}
          <circle cx={cx} cy={cy} r={3} fill="#d4a574" opacity="0.6" />

          {/* Scan line across globe */}
          <line
            x1={cx - R}
            y1={cy + Math.sin(t * 0.7) * R * 0.8}
            x2={cx + R}
            y2={cy + Math.sin(t * 0.7) * R * 0.8}
            stroke="#d4a574"
            strokeWidth="0.5"
            opacity="0.2"
            clipPath="url(#globeClip)"
          />

          {/* Grid floor */}
          <g opacity="0.12" transform={`translate(${cx}, ${cy + R + 30})`}>
            {[-5,-4,-3,-2,-1,0,1,2,3,4,5].map(i => (
              <g key={i}>
                <line x1={i * 20} y1={0} x2={i * 20 - 40} y2={40} stroke="#d4a574" strokeWidth="0.5" />
                <line x1={-100 + i * 20} y1={i * 8} x2={100 + i * 0} y2={i * 8} stroke="#d4a574" strokeWidth="0.5" />
              </g>
            ))}
          </g>

          {/* Status text */}
          <text x={cx} y={cy + R + 22} textAnchor="middle" fill="#7a7268" fontSize="8" letterSpacing="3" fontFamily="JetBrains Mono, monospace">
            NÚCLEO · {ready ? 'ONLINE' : 'INIT'}
          </text>
        </svg>
      </div>

      {/* Floating particles */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {[...Array(18)].map((_, i) => {
          const angle = (i / 18) * Math.PI * 2 + t * (i % 2 === 0 ? 0.15 : -0.1);
          const r = 200 + (i % 4) * 50;
          const x = 50 + (Math.cos(angle) * r / 8);
          const y = 50 + (Math.sin(angle) * r / 16);
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${x}%`, top: `${y}%`,
              width: i % 3 === 0 ? 2 : 1,
              height: i % 3 === 0 ? 2 : 1,
              borderRadius: '50%',
              background: '#d4a574',
              opacity: 0.3 + (i % 5) * 0.1,
            }} />
          );
        })}
      </div>

      {/* OVERLAY PANELS */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* Top left label */}
        <div className="jv-holo-in" style={{ position: 'absolute', top: 20, left: 28, pointerEvents: 'auto' }}>
          <div style={{ fontFamily: '"Fraunces", serif', fontStyle: 'italic', fontSize: 18, color: '#d4a574' }}>Projeção</div>
          <div style={{ fontSize: 9, color: '#7a7268', letterSpacing: '0.32em', marginTop: 4 }}>NÚCLEO · TOPOLOGIA</div>
        </div>

        {/* Top center labels */}
        <div className="jv-holo-in" style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 18, fontSize: 9, letterSpacing: '0.28em', color: '#7a7268', pointerEvents: 'auto' }}>
          {['NÚCLEO','ARQUIVO','DIPLOMACIA'].map(l => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#d4a574' }} />
              <span>{l}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: speaking || listening ? '#d4a574' : '#4a4540' }} className={speaking || listening ? 'jv-pulse' : ''} />
            <span style={{ color: speaking || listening ? '#7a7268' : '#4a4540' }}>VOZ</span>
          </div>
        </div>

        {/* Bottom left — telemetria */}
        <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, left: 28, pointerEvents: 'auto' }}>
          <HoloPanel C={C}>
            <div style={{ fontSize: 9, color: '#7a7268', letterSpacing: '0.32em', marginBottom: 10 }}>TELEMETRIA · TEMPO REAL</div>
            <HoloRow label="CARGA" value={`${Math.round(telemetry.load)}%`} C={C} />
            <HoloRow label="MEMÓRIA" value={`${Math.round(telemetry.mem)}%`} C={C} />
            <HoloRow label="LATÊNCIA API" value={`${Math.round(telemetry.latency)} ms`} C={C} />
          </HoloPanel>
        </div>

        {/* Bottom right — última resposta */}
        {lastMessage && (
          <div className="jv-holo-in" style={{ position: 'absolute', bottom: 24, right: 28, maxWidth: 380, pointerEvents: 'auto' }} key={history.length}>
            <HoloPanel C={C}>
              <div style={{ fontSize: 9, color: '#7a7268', letterSpacing: '0.32em', marginBottom: 10 }}>ÚLTIMA RESPOSTA</div>
              <div style={{ fontSize: 12, lineHeight: 1.65, color: '#e8e2d4', maxHeight: 150, overflowY: 'auto' }} className="jv-scrollbar">
                {lastMessage.type === 'ai'
                  ? lastMessage.text?.slice(0, 380) + (lastMessage.text?.length > 380 ? '…' : '')
                  : lastMessage.lines?.join(' ')}
              </div>
            </HoloPanel>
          </div>
        )}

        {/* Thinking overlay */}
        {thinking && (
          <div className="jv-holo-in" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ display: 'inline-block', padding: '14px 28px', border: '1px solid rgba(212,165,116,0.28)', background: 'rgba(11,10,8,0.7)', backdropFilter: 'blur(6px)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.32em', color: '#d4a574' }} className="jv-pulse">CONSULTANDO CÓRTEX · IA</div>
            </div>
          </div>
        )}

        {/* Vignette */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 45%, rgba(11,10,8,0.65) 100%)' }} />
      </div>
    </div>
  );
}


function HoloPanel({ children, C }) {
  return (
    <div className="jv-holo-glass jv-drift" style={{ padding: '16px 18px', position: 'relative', minWidth: 200 }}>
      {['tl','tr','bl','br'].map(p => {
        const s = { position: 'absolute', width: 8, height: 8 };
        const styles = { tl: { ...s, top:-1,left:-1,borderTop:`1px solid ${C.accent}`,borderLeft:`1px solid ${C.accent}` }, tr: { ...s, top:-1,right:-1,borderTop:`1px solid ${C.accent}`,borderRight:`1px solid ${C.accent}` }, bl: { ...s, bottom:-1,left:-1,borderBottom:`1px solid ${C.accent}`,borderLeft:`1px solid ${C.accent}` }, br: { ...s, bottom:-1,right:-1,borderBottom:`1px solid ${C.accent}`,borderRight:`1px solid ${C.accent}` } };
        return <span key={p} style={styles[p]} />;
      })}
      {children}
    </div>
  );
}

function HoloRow({ label, value, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 11 }}>
      <span style={{ color: C.muted, letterSpacing: '0.14em', minWidth: 78 }}>{label}</span>
      <span style={{ color: C.accent, flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TERMINAL VIEW
// ═══════════════════════════════════════════════════
function TerminalView({ scrollRef, bootStage, history, thinking, C, serif }) {
  return (
    <div ref={scrollRef} className="jv-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '36px 56px 24px 56px' }}>
      <BootSequence stage={bootStage} C={C} serif={serif} />
      {history.map((msg, i) => (
        <div key={i} className="jv-fade" style={{ marginBottom: 28 }}>
          {msg.role === 'operator' ? <OperatorLine msg={msg} C={C} /> : <JarvisResponse msg={msg} C={C} serif={serif} />}
        </div>
      ))}
      {thinking && <ThinkingIndicator C={C} />}
    </div>
  );
}

function VoiceIndicator({ voiceOut, speaking, listening, onToggle, onPanel, C, supported }) {
  const state = speaking ? 'speaking' : listening ? 'listening' : voiceOut ? 'on' : 'off';
  const color = state !== 'off' ? C.accent : C.muted;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button onClick={onToggle} disabled={!supported} style={{ background: 'transparent', border: 'none', cursor: supported ? 'pointer' : 'not-allowed', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', height: 12, width: 14 }}>
          {speaking ? <>{[12,12,12].map((h,i) => <span key={i} className="jv-wave-bar" style={{ height: h }} />)}</> : <><span style={{ width: 2, height: 4, background: color }} /><span style={{ width: 2, height: 8, background: color }} /><span style={{ width: 2, height: 6, background: color }} /></>}
        </span>
        <span style={{ color, fontSize: 10, letterSpacing: '0.22em' }}>{state === 'speaking' ? 'FALANDO' : state === 'listening' ? 'OUVINDO' : state === 'on' ? 'VOZ ATIVA' : 'VOZ'}</span>
      </button>
      <button onClick={onPanel} style={{ background: 'transparent', border: `1px solid ${C.line}`, color: C.muted, padding: '2px 6px', fontFamily: 'inherit', fontSize: 9, letterSpacing: '0.2em', cursor: 'pointer' }}>◇</button>
    </div>
  );
}

function ToggleBtn({ label, on, onClick, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.28em', color: C.muted }}>{label}</span>
      <button onClick={onClick} style={{ background: on ? 'rgba(212,165,116,0.15)' : 'transparent', border: `1px solid ${on ? C.accent : C.line}`, color: on ? C.accent : C.muted, padding: '6px 12px', fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.2em', cursor: 'pointer' }}>
        {on ? '◉ ON' : '○ OFF'}
      </button>
    </div>
  );
}

function MicButton({ listening, onStart, onStop, disabled, C }) {
  return (
    <button onClick={listening ? onStop : onStart} disabled={disabled} className={listening ? 'jv-ring' : ''}
      style={{ background: listening ? C.accent : 'transparent', border: `1px solid ${listening ? C.accent : (disabled ? C.dim : C.accentDim)}`, color: listening ? C.bg : (disabled ? C.dim : C.accent), width: 34, height: 34, borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', fontSize: 14, transition: 'all 0.2s' }}>
      {listening ? <span style={{ display: 'inline-flex', gap: 1.5, alignItems: 'center', height: 12 }}>{[12,12,12].map((h,i)=><span key={i} className="jv-wave-bar" style={{ height: h, background: C.bg }} />)}</span> : <span style={{ lineHeight: 1, fontSize: 13 }}>◐</span>}
    </button>
  );
}

function BootSequence({ stage, C, serif }) {
  const lines = ['núcleo cognitivo · online', 'arquivo persistente · L1·L2·L3 sincronizados', 'conselheiros · 5/5 ativos', 'api claude · claude-sonnet-4 · conectada'];
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
          <div style={{ ...serif, fontSize: 32, fontWeight: 300, color: C.text, lineHeight: 1.2 }}>
            IA conectada e <span style={{ fontStyle: 'italic', color: C.accent }}>operacional</span>.
          </div>
          <div style={{ marginTop: 12, fontSize: 12.5, color: C.muted, letterSpacing: '0.04em', lineHeight: 1.7 }}>
            Todas as mensagens são processadas em tempo real pelo <span style={{ color: C.accent }}>Claude Sonnet 4</span>. O histórico da conversa é mantido durante a sessão.
          </div>
        </div>
      )}
    </div>
  );
}

function OperatorLine({ msg, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
      <span style={{ color: C.dim, fontSize: 10, letterSpacing: '0.22em', minWidth: 78 }}>OPERADOR</span>
      <span style={{ color: C.text, fontSize: 13.5 }}>{msg.content}</span>
    </div>
  );
}

function ThinkingIndicator({ C }) {
  return (
    <div className="jv-fade" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
      <span style={{ color: C.accentDim, fontSize: 10, letterSpacing: '0.22em', minWidth: 78 }}>JARVIS</span>
      <span style={{ color: C.muted, fontSize: 11.5, letterSpacing: '0.12em' }}>
        <span className="jv-pulse">consultando córtex · aguardando resposta da IA</span>
        <span className="jv-blink" style={{ marginLeft: 6 }}>···</span>
      </span>
    </div>
  );
}

// ── AI Text Renderer — handles markdown-like formatting ──
function AIText({ text, C }) {
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
      elements.push(<code key={i} style={{ background: 'rgba(212,165,116,0.08)', color: C.accent, padding: '1px 6px', fontSize: 12 }}>{line.slice(1,-1)}</code>);
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      // Inline bold/code
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      elements.push(
        <div key={i} style={{ fontSize: 13.5, color: C.text, lineHeight: 1.75, marginBottom: 2 }}>
          {parts.map((p, j) => {
            if (p.startsWith('**') && p.endsWith('**')) return <strong key={j} style={{ color: C.accent, fontWeight: 600 }}>{p.slice(2,-2)}</strong>;
            if (p.startsWith('`') && p.endsWith('`')) return <code key={j} style={{ background: 'rgba(212,165,116,0.08)', color: C.accent, padding: '1px 5px', fontSize: 11.5 }}>{p.slice(1,-1)}</code>;
            return p;
          })}
        </div>
      );
    }
  });

  return <div>{elements}</div>;
}

function JarvisResponse({ msg, C, serif }) {
  const W = ({ children }) => (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ color: C.accent, fontSize: 10, letterSpacing: '0.22em', minWidth: 78, paddingTop: 3 }}>JARVIS</span>
      <div style={{ flex: 1, maxWidth: '100%', overflow: 'hidden' }}>{children}</div>
    </div>
  );

  if (msg.type === 'ai') {
    return <W><AIText text={msg.text} C={C} /></W>;
  }
  if (msg.type === 'focus') {
    return <W>
      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.75 }}>
        <div style={{ color: C.accent, marginBottom: 6 }}>◆ Modo foco ativado — {msg.topic}</div>
        <div style={{ color: C.muted }}>Sentinelas em silêncio. Notificações suspensas.</div>
        <div style={{ color: C.muted }}>Bloco sugerido: 90 minutos.</div>
      </div>
    </W>;
  }
  return <W>
    <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.75 }}>
      {(msg.lines || []).map((l, i) => <div key={i} className="jv-fade" style={{ animationDelay: `${i*120}ms`, marginBottom: 4 }}>{l}</div>)}
    </div>
  </W>;
}

function Meter({ label, value, unit, C }) {
  const segments = 12, filled = Math.round((value / 100) * segments);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dim, letterSpacing: '0.28em', marginBottom: 6 }}>
        <span>{label}</span><span style={{ color: C.accent }}>{value}{unit}</span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: segments }).map((_, i) => <span key={i} style={{ flex: 1, height: 5, background: i < filled ? C.accent : 'rgba(212,165,116,0.1)', opacity: i < filled ? (0.4 + (i / segments) * 0.6) : 1 }} />)}
      </div>
    </div>
  );
}
