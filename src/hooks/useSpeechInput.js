import { useState, useEffect, useRef, useCallback } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';

function float32ToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  return int16;
}

export function useSpeechInput({ onFinalTranscript, onInterrupt, elState }) {
  const [listening, setListening] = useState(false);
  const [sttError, setSttError] = useState(null);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [conversationMode, setConversationMode] = useState(false);

  const wsRef = useRef(null);
  const onFinalRef = useRef(onFinalTranscript);
  const onInterruptRef = useRef(onInterrupt);
  const elStateRef = useRef(elState);

  useEffect(() => { onFinalRef.current = onFinalTranscript; }, [onFinalTranscript]);
  useEffect(() => { onInterruptRef.current = onInterrupt; }, [onInterrupt]);
  useEffect(() => { elStateRef.current = elState; }, [elState]);

  const closeWS = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'CloseStream' })); } catch (_) {}
    }
    wsRef.current = null;
  }, []);

  const openWebSocket = useCallback(async () => {
    try {
      const res = await fetch('/api/stt-token');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSttError(err.error || `token: ${res.status}`);
        return null;
      }
      const { key } = await res.json();

      const params = new URLSearchParams({
        model: 'nova-3',
        language: 'pt-BR',
        punctuate: 'true',
        interim_results: 'true',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        access_token: key,
      });

      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const alt = data?.channel?.alternatives?.[0];
          const transcript = alt?.transcript?.trim();
          if (!transcript) return;

          if (data.is_final) {
            setPartialTranscript('');
            setListening(false);
            onFinalRef.current?.(transcript);
          } else {
            setPartialTranscript(transcript);
          }
        } catch (_) {}
      };
      ws.onerror = () => setSttError('erro WebSocket Deepgram');
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
      };
      wsRef.current = ws;
      return ws;
    } catch (e) {
      setSttError('falha ao conectar Deepgram · ' + e.message);
      return null;
    }
  }, []);

  const vad = useMicVAD({
    startOnLoad: conversationMode,
    baseAssetPath: '/',
    onnxWASMBasePath: '/',
    additionalAudioConstraints: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16000,
    },
    onSpeechStart: () => {
      setSttError(null);
      setListening(true);
      // Interrupt TTS if speaking
      if (elStateRef.current === 'speaking') {
        onInterruptRef.current?.();
      }
      openWebSocket();
    },
    onSpeechEnd: (audio) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setListening(false);
        setPartialTranscript('');
        return;
      }
      const int16 = float32ToInt16(audio);
      ws.send(int16.buffer);
      ws.send(JSON.stringify({ type: 'CloseStream' }));
      wsRef.current = null;
    },
    onVADMisfire: () => {
      closeWS();
      setListening(false);
      setPartialTranscript('');
    },
  });

  // Manual start/stop for non-conversation mode
  const startListening = useCallback(() => {
    if (conversationMode) return;
    setSttError(null);
    vad.start?.();
  }, [conversationMode, vad]);

  const stopListening = useCallback(() => {
    if (conversationMode) return;
    vad.pause?.();
    closeWS();
    setListening(false);
    setPartialTranscript('');
  }, [conversationMode, vad, closeWS]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => { closeWS(); };
  }, [closeWS]);

  return {
    listening,
    sttError,
    partialTranscript,
    conversationMode,
    setConversationMode,
    startListening,
    stopListening,
    deepgramSupported: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  };
}
