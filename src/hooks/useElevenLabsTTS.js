import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchVoicesList } from '../lib/elevenlabs.js';

const DEFAULT_VOICE_NAME = 'IA JARVIS';

export function useElevenLabsTTS({ webSpeakSingle }) {
  const [elVoices, setElVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [elStyle, setElStyle] = useState(0.0);
  const [elState, setElState] = useState('idle');
  const [fallbackActive, setFallbackActive] = useState(false);
  const [elError, setElError] = useState(null);

  // Stable refs — read inside async callbacks without stale closure
  const paramsRef = useRef({ voiceId: '', stability: 0.5, similarityBoost: 0.75, style: 0.0 });
  const queueRef = useRef([]);
  const currentItemRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const webSpeakRef = useRef(webSpeakSingle);

  useEffect(() => { webSpeakRef.current = webSpeakSingle; }, [webSpeakSingle]);

  useEffect(() => {
    paramsRef.current = { voiceId: selectedVoiceId, stability, similarityBoost, style: elStyle };
  }, [selectedVoiceId, stability, similarityBoost, elStyle]);

  useEffect(() => {
    fetchVoicesList()
      .then(data => {
        const voices = data.voices || [];
        const match = voices.find(x => x.name.trim().toLowerCase() === DEFAULT_VOICE_NAME.toLowerCase());
        if (match) {
          setElVoices([match]);
          setSelectedVoiceId(v => v || match.voice_id);
        } else {
          setElVoices(voices);
          setElError(`voz "${DEFAULT_VOICE_NAME}" não encontrada na conta`);
          setSelectedVoiceId(v => v || (voices[0]?.voice_id ?? ''));
        }
      })
      .catch(e => setElError('falha ao carregar vozes · ' + e.message));
  }, []);

  // Só sintetiza com antecedência o item na cabeça da fila (no máximo 1 à frente
  // do que está tocando) — nunca a fila inteira de uma vez. Isso evita disparar N
  // requisições concorrentes ao ElevenLabs quando várias frases são enfileiradas
  // em rajada (ex: fim do streaming), o que estourava o limite de requisições
  // concorrentes da conta e derrubava frases individuais pro fallback Web Speech.
  function maybeStartPrefetch() {
    const next = queueRef.current[0];
    if (next && !next.bufferPromise) {
      next.bufferPromise = synthesize(next, paramsRef.current);
    }
  }

  // Síntese (fetch + decode) de um item.
  async function synthesize(item, params) {
    const { voiceId, stability: stab, similarityBoost: sim, style: sty } = params;
    item.abortController = new AbortController();

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.text, voiceId, stability: stab, similarityBoost: sim, style: sty }),
        signal: item.abortController.signal,
      });

      if (!res.ok) {
        item.httpStatus = res.status;
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      return await audioCtxRef.current.decodeAudioData(arrayBuffer);
    } catch (e) {
      if (e.name === 'AbortError') { item.aborted = true; return null; }
      item.fetchError = e;
      return null;
    }
  }

  // playNext is held in a ref so recursive calls always reach the latest version
  const playNextRef = useRef(null);
  playNextRef.current = async function playNext() {
    if (queueRef.current.length === 0) {
      currentItemRef.current = null;
      isSpeakingRef.current = false;
      setElState('idle');
      return;
    }

    isSpeakingRef.current = true;
    setElState('speaking');
    const item = queueRef.current.shift();
    currentItemRef.current = item;
    if (!item.bufferPromise) item.bufferPromise = synthesize(item, paramsRef.current);
    // Assim que este item vira "o atual", a cabeça da fila (o próximo depois dele)
    // pode começar a sintetizar em paralelo — mantém no máx. 2 requisições em voo.
    maybeStartPrefetch();

    const buffer = await item.bufferPromise;

    if (item.aborted) {
      // stop() cancelou este item enquanto ele ainda sintetizava — não cai no
      // fallback Web Speech, apenas encerra silenciosamente.
      item.resolve();
      currentItemRef.current = null;
      isSpeakingRef.current = false;
      setElState('idle');
      return;
    }

    if (!buffer) {
      if (item.httpStatus === 401) setElError('chave de API inválida · verifique ELEVENLABS_API_KEY');
      else if (item.httpStatus === 429) setElError('limite de requisições atingido · aguarde');
      else if (item.httpStatus) setElError(`erro ElevenLabs ${item.httpStatus}`);
      else if (item.fetchError) setElError('erro de rede · ' + item.fetchError.message);
      setFallbackActive(true);
      webSpeakRef.current?.(item.text);
      item.resolve();
      playNextRef.current();
      return;
    }

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtxRef.current.destination);
    sourceRef.current = source;
    source.onended = () => {
      setFallbackActive(false);
      setElError(null);
      item.resolve();
      playNextRef.current();
    };
    source.start();
  };

  const speak = useCallback((text) => {
    if (!text?.trim()) return Promise.resolve();
    return new Promise(resolve => {
      const item = { text, resolve, bufferPromise: null };
      queueRef.current.push(item);
      maybeStartPrefetch();
      if (!isSpeakingRef.current) playNextRef.current();
    });
  }, []);

  const stop = useCallback(() => {
    currentItemRef.current?.abortController?.abort();
    queueRef.current.forEach(item => item.abortController?.abort());
    try { sourceRef.current?.stop(); } catch (_) {}
    queueRef.current = [];
    currentItemRef.current = null;
    isSpeakingRef.current = false;
    setElState('idle');
  }, []);

  return {
    elVoices, selectedVoiceId, setSelectedVoiceId,
    stability, setStability,
    similarityBoost, setSimilarityBoost,
    elStyle, setElStyle,
    elState, fallbackActive, elError,
    speak, stop,
  };
}
