import { useState } from 'react';
import { callClaude, splitIntoSpeakableChunks } from '../lib/anthropic.js';

export function useChat({ speakChunks, setTelemetry, apiHistoryRef }) {
  const [history, setHistory] = useState([]);
  const [apiHistory, setApiHistory] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [apiError, setApiError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [activeBadge, setActiveBadge] = useState(null);

  const handleLocalCommand = (cmd, currentApiHistory) => {
    const lower = cmd.trim().toLowerCase();

    if (lower === '/holo' || lower === '/holografia' || lower === '/armor') {
      return { type: 'text', lines: [
        'Projeção holográfica Mark VII iniciada.',
        'Arc reactor online · topologia visível.',
        lower === '/armor' ? 'Interface de combate carregada, Sir.' : 'Modo holográfico ativo.',
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
        '◉ MARK VII · standby · disponível para deploy',
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
        '/armor ou /holo → projeção holográfica Mark VII',
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

  const submitCommand = async (cmd, { onModeChange, onFocusChange } = {}) => {
    if (!cmd || !cmd.trim() || thinking) return;
    setApiError(null);

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

    setHistory(h => [...h, { role: 'operator', content: cmd, ts: new Date() }]);
    setThinking(true);

    const newApiHistory = [...currentApiHistory, { role: 'user', content: cmd }];
    setApiHistory(newApiHistory);
    if (apiHistoryRef) apiHistoryRef.current = newApiHistory;

    try {
      const t0 = Date.now();
      let ttsBuffer = '';

      const { text: responseText, jarvis } = await callClaude(newApiHistory, {
        onChunk: (_chunk, fullText) => {
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
        },
      });

      const elapsed = Date.now() - t0;
      setStreamText('');

      setTelemetry(p => ({ ...p, latency: Math.round(elapsed * 0.4 + p.latency * 0.6) }));

      const updatedApiHistory = [...newApiHistory, { role: 'assistant', content: responseText }];
      setApiHistory(updatedApiHistory);
      if (apiHistoryRef) apiHistoryRef.current = updatedApiHistory;

      setHistory(h => [...h, { role: 'jarvis', type: 'ai', text: responseText, ts: new Date() }]);
      setThinking(false);

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
      setThinking(false);
      const errMsg = err.message || 'Erro desconhecido';
      console.error('J.A.R.V.I.S. API Error:', { message: errMsg, stack: err.stack, timestamp: new Date().toISOString() });

      let errorType = 'Desconhecido';
      let userMessage = 'Verifique a conectividade com o núcleo Stark.';
      if (errMsg.includes('API 400')) { errorType = 'Requisição Inválida'; userMessage = 'Verificar configuração da requisição ou credenciais.'; }
      else if (errMsg.includes('API 401')) { errorType = 'Autenticação'; userMessage = 'Chave API inválida ou expirada no Vercel.'; }
      else if (errMsg.includes('API 403')) { errorType = 'Permissão'; userMessage = 'Chave API sem permissão para este modelo.'; }
      else if (errMsg.includes('API 429')) { errorType = 'Limite'; userMessage = 'Muitas requisições. Aguarde e tente novamente.'; }
      else if (errMsg.includes('API 500')) { errorType = 'Servidor'; userMessage = 'Servidores indisponíveis no momento.'; }
      else if (errMsg.includes('fetch')) { errorType = 'Conexão'; userMessage = 'Verificar conexão com internet ou CORS.'; }

      setApiError(`[${errorType}] ${errMsg}`);
      setErrorDetails({ type: errorType, fullMessage: errMsg, stack: err.stack });
      setHistory(h => [...h, { role: 'jarvis', type: 'text', lines: [`Falha no núcleo: ${errorType}`, userMessage], ts: new Date() }]);
    }
  };

  const clearHistory = () => {
    setApiHistory([]);
    setHistory([]);
    if (apiHistoryRef) apiHistoryRef.current = [];
  };

  return {
    history, apiHistory,
    thinking, streamText, activeBadge,
    apiError, errorDetails, showErrorDetails,
    setShowErrorDetails, setApiError, setErrorDetails,
    submitCommand, clearHistory,
  };
}
