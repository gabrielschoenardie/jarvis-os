import { useState, useEffect, useRef, useCallback } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';

function float32ToBase64PCM(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
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
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
      wsRef.current = null;
    }
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

      const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${key}`);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const transcript = data?.text?.trim();
          if (!transcript) return;

          if (data.message_type === 'committed_transcript') {
            setPartialTranscript('');
            setListening(false);
            onFinalRef.current?.(transcript);
          } else if (data.message_type === 'partial_transcript') {
            setPartialTranscript(transcript);
          }
        } catch (_) {}
      };
      ws.onerror = () => setSttError('erro WebSocket ElevenLabs Scribe');
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
      };
      wsRef.current = ws;
      return ws;
    } catch (e) {
      setSttError('falha ao conectar Scribe · ' + e.message);
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
      ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: float32ToBase64PCM(audio),
        commit: true,
        sample_rate: 16000,
      }));
      wsRef.current = null;
    },
    onVADMisfire: () => {
      closeWS();
      setListening(false);
      setPartialTranscript('');
    },
  });

  // Fix 1: React to conversation mode toggle
  useEffect(() => {
    if (conversationMode) {
      if (!vad.loading) {
        setSttError(null);
        vad.start?.();
      }
      // If still loading, Fix 2 (below) will auto-start when ready
    } else {
      vad.pause?.();
      closeWS();
      setListening(false);
      setPartialTranscript('');
    }
  }, [conversationMode, vad.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 2: Auto-start when VAD finishes loading and conversation mode is already ON
  useEffect(() => {
    if (!vad.loading && conversationMode) {
      setSttError(null);
      vad.start?.();
    }
  }, [vad.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 3: Surface VAD initialization errors
  useEffect(() => {
    if (vad.errored) {
      setSttError('VAD: ' + (typeof vad.errored === 'string' ? vad.errored : vad.errored?.message || 'falha ao inicializar'));
    }
  }, [vad.errored]);

  // Manual start/stop for non-conversation mode
  const startListening = useCallback(() => {
    if (conversationMode) return;
    if (vad.loading) {
      setSttError('aguarde: inicializando VAD...');
      return;
    }
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
    vadLoading: vad.loading,
  };
}
