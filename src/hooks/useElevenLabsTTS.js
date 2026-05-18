import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchVoicesList } from '../lib/elevenlabs.js';

export function useElevenLabsTTS({ webSpeakSingle }) {
  const [elVoices, setElVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [elStyle, setElStyle] = useState(0.0);
  const [elState, setElState] = useState('idle');
  const [fallbackActive, setFallbackActive] = useState(false);

  // Stable refs — read inside async callbacks without stale closure
  const paramsRef = useRef({ voiceId: '', stability: 0.5, similarityBoost: 0.75, style: 0.0 });
  const queueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const abortRef = useRef(null);
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
        setElVoices(voices);
        if (voices.length > 0) setSelectedVoiceId(v => v || voices[0].voice_id);
      })
      .catch(() => {});
  }, []);

  // playNext is held in a ref so recursive calls always reach the latest version
  const playNextRef = useRef(null);
  playNextRef.current = async function playNext() {
    if (queueRef.current.length === 0) {
      isSpeakingRef.current = false;
      setElState('idle');
      return;
    }

    isSpeakingRef.current = true;
    setElState('speaking');
    const { text, resolve } = queueRef.current.shift();
    const { voiceId, stability: stab, similarityBoost: sim, style: sty } = paramsRef.current;

    if (!voiceId) {
      // No voice ID yet — fall back and continue queue
      setFallbackActive(true);
      webSpeakRef.current?.(text);
      resolve();
      playNextRef.current();
      return;
    }

    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId, stability: stab, similarityBoost: sim, style: sty }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        if (res.status === 429 || res.status === 401) {
          setFallbackActive(true);
          webSpeakRef.current?.(text);
        }
        resolve();
        playNextRef.current();
        return;
      }

      const arrayBuffer = await res.arrayBuffer();

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      const decoded = await audioCtxRef.current.decodeAudioData(arrayBuffer);
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = decoded;
      source.connect(audioCtxRef.current.destination);
      sourceRef.current = source;
      source.onended = () => {
        setFallbackActive(false);
        resolve();
        playNextRef.current();
      };
      source.start();
    } catch (e) {
      if (e.name === 'AbortError') {
        resolve();
        isSpeakingRef.current = false;
        setElState('idle');
        return;
      }
      setFallbackActive(true);
      webSpeakRef.current?.(text);
      resolve();
      playNextRef.current();
    }
  };

  const speak = useCallback((text) => {
    if (!text?.trim()) return Promise.resolve();
    return new Promise(resolve => {
      queueRef.current.push({ text, resolve });
      if (!isSpeakingRef.current) playNextRef.current();
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    try { sourceRef.current?.stop(); } catch (_) {}
    queueRef.current = [];
    isSpeakingRef.current = false;
    setElState('idle');
  }, []);

  return {
    elVoices, selectedVoiceId, setSelectedVoiceId,
    stability, setStability,
    similarityBoost, setSimilarityBoost,
    elStyle, setElStyle,
    elState, fallbackActive,
    speak, stop,
  };
}
