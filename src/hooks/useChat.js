import { useState, useEffect } from 'react';
import { callClaude, splitIntoSpeakableChunks } from '../lib/anthropic.js';
import { isWeatherQuery } from '../lib/weather.js';
import { stripImageAttachment } from '../lib/attachments.js';

const BACKOFF_MS = [2000, 4000, 8000];

const TOOL_LABELS = { web_search: 'BUSCA WEB', calcular: 'CÁLCULO', abrir_site: 'NAVEGADOR', hud_display: 'HUD DISPLAY' };

export function useChat({ speakChunks, setTelemetry, startTimer, stopTimer, apiHistoryRef }) {
  const [history, setHistory] = useState([]);
  const [apiHistory, setApiHistory] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [apiError, setApiError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [activeBadge, setActiveBadge] = useState(null);
  const [lastFailedCmd, setLastFailedCmd] = useState(null);
  const [lastFailedCallbacks, setLastFailedCallbacks] = useState(null);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [toolStatus, setToolStatus] = useState(null);
  // Janela flutuante de vídeo no HUD — estado vivo, nunca persistido (o chip
  // {type:'hud'} no history é o registro durável que sobrevive a F5).
  const [hudMedia, setHudMedia] = useState(null);

  const openHudMedia = media => {
    if (media?.videoId) setHudMedia({ videoId: media.videoId, title: media.title, channel: media.channel });
  };
  const closeHudMedia = () => setHudMedia(null);

  // Fase 10: restaurar histórico no mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('jarvis-history');
      if (saved) {
        const { api, ui } = JSON.parse(saved);
        const restoredApi = api || [];
        setApiHistory(restoredApi);
        if (apiHistoryRef) apiHistoryRef.current = restoredApi;
        setHistory(ui || []);
      }
    } catch (_) {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fase 10: persistir histórico a cada mudança
  useEffect(() => {
    if (history.length === 0 && apiHistory.length === 0) return;
    try {
      const MAX_TURNS = 20;
      // Nenhuma imagem em base64 vai pro localStorage — vira só o texto com o
      // marcador "[Anexo: nome]" (evita estourar a cota do browser).
      const compactedApi = apiHistory.map(m => ({ ...m, content: stripImageAttachment(m.content) }));
      localStorage.setItem('jarvis-history', JSON.stringify({
        api: compactedApi.slice(-MAX_TURNS * 2),
        ui: history.slice(-60),
      }));
    } catch (_) {}
  }, [history, apiHistory]);

  const handleLocalCommand = (cmd, currentApiHistory) => {
    const lower = cmd.trim().toLowerCase();

    if (lower === '/vault' || lower === '/holo' || lower === '/holografia' || lower === '/armor') {
      return { type: 'text', lines: [
        'Núcleo neural projetado.',
        'Grafo do vault Obsidian online, Sir.',
        lower === '/armor' ? 'Interface de combate carregada.' : 'Modo cérebro ativo.',
      ], switchMode: 'holographic' };
    }
    if (lower === '/terminal') {
      return { type: 'text', lines: ['Interface terminal restaurada.', 'Canal de dados padrão ativo.'], switchMode: 'terminal' };
    }
    if (lower.startsWith('/foco') || lower.match(/^modo foco/)) {
      const topic = cmd.replace(/^\/?foco\s*|^modo foco\s*/i, '').trim() || 'operação atual';
      return { type: 'focus', topic };
    }
    if (lower === '/sair' || lower === 'sair') {
      return { type: 'text', lines: ['Modo foco encerrado.', 'Canal aberto, Sir.'], clearFocus: true };
    }
    if (lower === '/status') {
      return { type: 'text', lines: [
        '═══ STARK INDUSTRIES · DIAGNÓSTICO ═══',
        '◉ MATRIX · online · latência nominal',
        '◉ NEXUS · online · 847.293 registros indexados',
        '◉ DEFESA · online · sem ameaças detectadas',
        '◉ VAULT · standby · núcleo neural disponível',
        '◉ ARC REACTOR · potência 100% · estável',
        `◉ MODELO · claude-sonnet-4.6 · ${currentApiHistory.length > 0 ? Math.min(Math.floor(currentApiHistory.length / 2), 20) + ' / 20 turnos' : 'contexto limpo'}`,
      ]};
    }
    if (lower === '/briefing') {
      return { type: 'text', lines: [
        '═══ BRIEFING · STARK INDUSTRIES ═══',
        `Operador: Sir Gabriel Schoenardie · Canoas, BRT -3`,
        `Sessão: ${Math.floor(currentApiHistory.length / 2)} interações · contexto ativo`,
        'Status operacional: todos os sistemas nominais.',
        'Sem alertas pendentes.',
        'Aguardando instruções, Sir.',
      ]};
    }
    if (lower === '/ajuda' || lower === '/help') {
      return { type: 'text', lines: [
        '═══ J.A.R.V.I.S. · COMANDOS ═══',
        '/vault ou /holo → cérebro neural do vault Obsidian',
        '/terminal → interface de terminal',
        '/foco [tema] → modo concentração',
        '/sair → encerrar modo foco',
        '/status → diagnóstico dos subsistemas',
        '/briefing → relatório operacional',
        '/ajuda → esta lista',
        '─────────────────────────────',
        'Tudo mais é enviado direto à IA, Sir.',
      ]};
    }
    return null;
  };

  const submitCommand = async (cmd, { onModeChange, onFocusChange, attachment } = {}) => {
    if (!cmd || !cmd.trim() || thinking) return;
    setApiError(null);
    setLastFailedCmd(null);
    setLastFailedCallbacks(null);

    const currentApiHistory = apiHistoryRef ? apiHistoryRef.current : [];
    const localResult = handleLocalCommand(cmd, currentApiHistory);

    if (localResult) {
      setHistory(h => [...h, { role: 'operator', content: cmd, ts: new Date() }]);
      setHistory(h => [...h, { role: 'jarvis', ...localResult, ts: new Date() }]);
      if (localResult.switchMode) onModeChange?.(localResult.switchMode);
      if (localResult.clearFocus) onFocusChange?.(null);
      if (localResult.type === 'focus') onFocusChange?.(localResult.topic);
      return;
    }

    setHistory(h => [...h, {
      role: 'operator', content: cmd,
      attachment: attachment ? { name: attachment.name, kind: attachment.kind } : undefined,
      ts: new Date(),
    }]);
    setThinking(true);

    // Pergunta sobre clima → busca o forecast de 7 dias em paralelo com o chat
    // (sem await — não atrasa a resposta). Falha silenciosa: sem card, a resposta
    // falada já cobre via injeção de prompt no /api/chat.
    const weatherPromise = isWeatherQuery(cmd)
      ? fetch('/api/weather').then(r => r.ok ? r.json() : null).catch(() => null)
      : null;

    // O texto do usuário fica no INÍCIO do bloco (não depois do marcador de
    // anexo) — detectCommand só reconhece /comando no começo da string.
    let userContent = cmd;
    if (attachment?.kind === 'image') {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data } },
        { type: 'text', text: `${cmd}\n\n[Anexo: ${attachment.name}]` },
      ];
    } else if (attachment?.kind === 'text') {
      userContent = `${cmd}\n\n[Anexo: ${attachment.name}]\n\`\`\`\n${attachment.data}\n\`\`\``;
    }

    const newApiHistory = [...currentApiHistory, { role: 'user', content: userContent }];
    setApiHistory(newApiHistory);
    if (apiHistoryRef) apiHistoryRef.current = newApiHistory;

    try {
      let ttsBuffer = '';
      let attempt = 0;
      let responseText = '';
      let jarvis = null;
      let tokenUsage = null;

      const onChunk = (_chunk, fullText) => {
        setStreamText(fullText);
        if (speakChunks) {
          const lastBoundary = Math.max(
            fullText.lastIndexOf('. '),
            fullText.lastIndexOf('! '),
            fullText.lastIndexOf('? ')
          );
          if (lastBoundary >= ttsBuffer.length) {
            const toSpeak = fullText.slice(ttsBuffer.length, lastBoundary + 2);
            ttsBuffer = fullText.slice(0, lastBoundary + 2);
            const chunks = splitIntoSpeakableChunks(toSpeak);
            if (chunks.length) speakChunks(chunks);
          }
        }
      };

      const onToolStatus = ev => {
        setToolStatus(ev.status === 'start' ? (TOOL_LABELS[ev.name] || ev.name.toUpperCase()) : null);
      };

      const onAction = ev => {
        if (ev.action === 'open_url') {
          // Best-effort: popup blockers barram window.open fora de gesto de
          // usuário (submits por voz não têm gesto) — o chip clicável abaixo é
          // o caminho garantido, e fica registrado no histórico.
          try { window.open(ev.url, '_blank', 'noopener,noreferrer'); } catch (_) {}
          setHistory(h => [...h, { role: 'jarvis', type: 'action', url: ev.url, label: ev.label, ts: new Date() }]);
          return;
        }
        if (ev.action === 'hud_video' && ev.videoId) {
          setHudMedia({ videoId: ev.videoId, title: ev.title, channel: ev.channel });
          setHistory(h => [...h, { role: 'jarvis', type: 'hud', videoId: ev.videoId, title: ev.title, channel: ev.channel, ts: new Date() }]);
        }
      };

      // Backoff para 429; apiT0 resetado a cada tentativa para medir só o tempo real da API
      while (true) {
        try {
          startTimer?.();
          const apiT0 = Date.now();
          ({ text: responseText, jarvis, tokenUsage } = await callClaude(newApiHistory, { onChunk, onAction, onToolStatus }));
          stopTimer?.(Date.now() - apiT0);
          break;
        } catch (err) {
          stopTimer?.(0);
          setToolStatus(null);
          if (err.message.includes('API 429') && attempt < BACKOFF_MS.length) {
            const wait = BACKOFF_MS[attempt];
            ttsBuffer = '';
            setStreamText(`⟳ aguardando ${wait / 1000}s · tentativa ${attempt + 1}/${BACKOFF_MS.length}...`);
            await new Promise(r => setTimeout(r, wait));
            setStreamText('');
            attempt++;
          } else {
            throw err;
          }
        }
      }

      setStreamText('');
      setToolStatus(null);

      const updatedApiHistory = [...newApiHistory, { role: 'assistant', content: responseText }];
      setApiHistory(updatedApiHistory);
      if (apiHistoryRef) apiHistoryRef.current = updatedApiHistory;

      setHistory(h => [...h, { role: 'jarvis', type: 'ai', text: responseText, ts: new Date() }]);
      setThinking(false);

      // Card visual de forecast: anexado após a resposta da IA, quando o fetch
      // paralelo resolver com dados válidos.
      weatherPromise?.then(forecast => {
        if (forecast?.daily?.length) {
          setHistory(h => [...h, { role: 'jarvis', type: 'weather', forecast, ts: new Date() }]);
        }
      });

      if (tokenUsage) {
        setSessionTokens(t => t + tokenUsage.input + tokenUsage.output);
      }

      if (jarvis?.badge) {
        setActiveBadge(jarvis.badge);
        setTimeout(() => setActiveBadge(null), 8000);
      }

      if (speakChunks) {
        const remaining = responseText.slice(ttsBuffer.length).trim();
        if (remaining) {
          const chunks = splitIntoSpeakableChunks(remaining);
          setTimeout(() => speakChunks(chunks), 250);
        }
      }
    } catch (err) {
      setStreamText('');
      setToolStatus(null);
      setThinking(false);
      stopTimer?.(0);
      const errMsg = err.message || 'Erro desconhecido';
      console.error('J.A.R.V.I.S. API Error:', { message: errMsg, stack: err.stack, timestamp: new Date().toISOString() });

      let errorType = 'Desconhecido';
      let userMessage = 'Verifique a conectividade com o núcleo Stark.';
      if (errMsg.includes('API 400')) { errorType = 'Requisição Inválida'; userMessage = 'Verificar configuração da requisição ou credenciais.'; }
      else if (errMsg.includes('API 401')) { errorType = 'Autenticação'; userMessage = 'Chave API inválida ou expirada no Vercel.'; }
      else if (errMsg.includes('API 403')) { errorType = 'Permissão'; userMessage = 'Chave API sem permissão para este modelo.'; }
      else if (errMsg.includes('API 429')) { errorType = 'Limite'; userMessage = 'Limite excedido após retentativas. Aguarde e tente novamente.'; }
      else if (errMsg.includes('API 500')) { errorType = 'Servidor'; userMessage = 'Servidores indisponíveis no momento.'; }
      else if (errMsg.includes('fetch')) { errorType = 'Conexão'; userMessage = 'Verificar conexão com internet ou CORS.'; }

      // Fix 1: armazenar último comando para retry
      setLastFailedCmd(cmd);
      setLastFailedCallbacks({ onModeChange, onFocusChange, attachment });
      setApiError(`[${errorType}] ${errMsg}`);
      setErrorDetails({ type: errorType, fullMessage: errMsg, stack: err.stack });
      setHistory(h => [...h, { role: 'jarvis', type: 'text', lines: [`Falha no núcleo: ${errorType}`, userMessage], ts: new Date() }]);
    }
  };

  // Fix 1: retentar último comando com um clique
  const retryLastCommand = () => {
    if (!lastFailedCmd) return;
    const cmd = lastFailedCmd;
    const callbacks = lastFailedCallbacks || {};
    setLastFailedCmd(null);
    setLastFailedCallbacks(null);
    submitCommand(cmd, callbacks);
  };

  const clearHistory = () => {
    setApiHistory([]);
    setHistory([]);
    setSessionTokens(0);
    if (apiHistoryRef) apiHistoryRef.current = [];
    localStorage.removeItem('jarvis-history');
  };

  return {
    history, apiHistory,
    thinking, streamText, activeBadge, toolStatus,
    hudMedia, openHudMedia, closeHudMedia,
    apiError, errorDetails, showErrorDetails,
    lastFailedCmd, sessionTokens,
    setShowErrorDetails, setApiError, setErrorDetails,
    submitCommand, retryLastCommand, clearHistory,
  };
}
