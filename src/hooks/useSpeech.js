import { useState, useEffect, useRef, useCallback } from 'react';
import { useElevenLabsTTS } from './useElevenLabsTTS.js';
import { useSpeechInput } from './useSpeechInput.js';
export function useSpeech({ onTranscriptReady, setInput }) {
  const [voiceOut, setVoiceOut] = useState(false);
  const [webSpeaking, setWebSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(0.92);

  const onTranscriptReadyRef = useRef(onTranscriptReady);
  useEffect(() => { onTranscriptReadyRef.current = onTranscriptReady; }, [onTranscriptReady]);

  const setInputRef = useRef(setInput);
  useEffect(() => { setInputRef.current = setInput; }, [setInput]);

  // Web Speech params ref — for ElevenLabs TTS fallback
  const wsParamsRef = useRef({ voices: [], selectedVoiceURI: null, rate: 0.95, pitch: 0.92 });
  useEffect(() => {
    wsParamsRef.current = { voices, selectedVoiceURI, rate, pitch };
  }, [voices, selectedVoiceURI, rate, pitch]);

  const speechSupported = typeof window !== 'undefined' && !!window.speechSynthesis;

  // Web Speech single utterance — ElevenLabs TTS fallback
  const webSpeakSingle = useCallback((text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const { voices: vs, selectedVoiceURI: uri, rate: r, pitch: p } = wsParamsRef.current;
    const voice = vs.find(v => v.voiceURI === uri);
    if (voice) u.voice = voice;
    u.lang = 'pt-BR'; u.rate = r; u.pitch = p;
    u.onstart = () => setWebSpeaking(true);
    u.onend = () => setWebSpeaking(false);
    u.onerror = () => setWebSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  const elevenLabs = useElevenLabsTTS({ webSpeakSingle });

  const speechInput = useSpeechInput({
    onFinalTranscript: (text) => {
      setInputRef.current?.(text);
      onTranscriptReadyRef.current?.(text);
    },
    onInterrupt: () => elevenLabs.stop(),
    elState: elevenLabs.elState,
  });

  const speaking = elevenLabs.elState === 'speaking' || webSpeaking;

  // Load Web Speech voices (for fallback selector in VoicePanel)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setVoiceError('síntese de voz indisponível');
      return;
    }
    const load = () => {
      const all = window.speechSynthesis.getVoices() || [];
      const pt = all.filter(v => v.lang.startsWith('pt'));
      const final = pt.length > 0 ? pt : all;
      setVoices(final);
      if (!selectedVoiceURI && final.length > 0) {
        const preferred =
          final.find(v => v.lang === 'pt-BR' && /felipe|daniel|male|masc/i.test(v.name)) ||
          final.find(v => v.lang === 'pt-BR') ||
          final[0];
        setSelectedVoiceURI(preferred?.voiceURI);
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const speak = (text) => {
    if (!voiceOut || !text) return;
    elevenLabs.speak(text);
  };

  const speakChunks = (chunks) => {
    if (!voiceOut || !chunks.length) return;
    chunks.forEach(chunk => elevenLabs.speak(chunk));
  };

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    setVoiceOut(next);
    if (next) {
      setTimeout(() => elevenLabs.speak('Canal de voz ativado, Sir. Estarei ouvindo.'), 100);
    } else {
      elevenLabs.stop();
      window.speechSynthesis?.cancel();
      setWebSpeaking(false);
    }
  };

  const stopSpeaking = () => {
    elevenLabs.stop();
    window.speechSynthesis?.cancel();
    setWebSpeaking(false);
  };

  return {
    voiceOut, speaking,
    listening: speechInput.listening,
    voices, selectedVoiceURI, setSelectedVoiceURI,
    voiceError, voicePanelOpen, setVoicePanelOpen,
    rate, setRate, pitch, setPitch,
    speechSupported,
    recogSupported: speechInput.deepgramSupported,
    vadLoading: speechInput.vadLoading,
    speak, speakChunks, toggleVoiceOut, stopSpeaking,
    startListening: speechInput.startListening,
    stopListening: speechInput.stopListening,
    partialTranscript: speechInput.partialTranscript,
    sttError: speechInput.sttError,
    conversationMode: speechInput.conversationMode,
    setConversationMode: speechInput.setConversationMode,
    // ElevenLabs
    elVoices: elevenLabs.elVoices,
    selectedVoiceId: elevenLabs.selectedVoiceId,
    setSelectedVoiceId: elevenLabs.setSelectedVoiceId,
    stability: elevenLabs.stability,
    setStability: elevenLabs.setStability,
    similarityBoost: elevenLabs.similarityBoost,
    setSimilarityBoost: elevenLabs.setSimilarityBoost,
    elStyle: elevenLabs.elStyle,
    setElStyle: elevenLabs.setElStyle,
    fallbackActive: elevenLabs.fallbackActive,
    elError: elevenLabs.elError,
  };
}
