import { useState, useEffect, useRef } from 'react';

export function useSpeech({ onTranscriptReady }) {
  const [voiceOut, setVoiceOut] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [rate, setRate] = useState(0.95);
  const [pitch, setPitch] = useState(0.92);

  const recognitionRef = useRef(null);
  const pendingSubmitRef = useRef(null);
  const onTranscriptReadyRef = useRef(onTranscriptReady);
  useEffect(() => { onTranscriptReadyRef.current = onTranscriptReady; }, [onTranscriptReady]);

  const speechSupported = typeof window !== 'undefined' && !!window.speechSynthesis;
  const recogSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

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
    r.onresult = (e) => { const t = e.results[0][0].transcript; pendingSubmitRef.current = t; };
    r.onerror = (e) => { setVoiceError(`reconhecimento · ${e.error}`); setListening(false); };
    r.onend = () => {
      setListening(false);
      if (pendingSubmitRef.current) {
        const cmd = pendingSubmitRef.current;
        pendingSubmitRef.current = null;
        setTimeout(() => onTranscriptReadyRef.current?.(cmd), 200);
      }
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

  const speakChunks = (chunks) => {
    if (!voiceOut || !window.speechSynthesis || !chunks.length) return;
    window.speechSynthesis.cancel();
    let i = 0;
    const next = () => {
      if (i >= chunks.length) { setSpeaking(false); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      const voice = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (voice) u.voice = voice;
      u.lang = 'pt-BR'; u.rate = rate; u.pitch = pitch;
      u.onstart = () => setSpeaking(true);
      u.onend = next;
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    };
    next();
  };

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    setVoiceOut(next);
    if (next) {
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance('Canal de voz ativado, Sir. Estarei ouvindo.');
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

  const stopListening = () => {
    if (recognitionRef.current && listening) try { recognitionRef.current.stop(); } catch (e) {}
  };

  const stopSpeaking = () => { window.speechSynthesis?.cancel(); setSpeaking(false); };

  return {
    voiceOut, speaking, listening,
    voices, selectedVoiceURI, setSelectedVoiceURI,
    voiceError, voicePanelOpen, setVoicePanelOpen,
    rate, setRate, pitch, setPitch,
    speechSupported, recogSupported,
    speak, speakChunks, toggleVoiceOut,
    startListening, stopListening, stopSpeaking,
  };
}
