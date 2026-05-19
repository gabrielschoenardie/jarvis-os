import { useEffect, useRef, useState } from 'react';
import { usePorcupine } from '@picovoice/porcupine-react';
import { BuiltInKeyword } from '@picovoice/porcupine-web';

const ACCESS_KEY = import.meta.env.VITE_PICOVOICE_ACCESS_KEY;

export function useWakeWord({ onWakeWord, enabled }) {
  const { keywordDetection, isLoaded, isListening, error, init, start, stop, release } = usePorcupine();
  const [wakeWordError, setWakeWordError] = useState(null);
  const onWakeWordRef = useRef(onWakeWord);
  const initStartedRef = useRef(false);

  useEffect(() => { onWakeWordRef.current = onWakeWord; }, [onWakeWord]);

  useEffect(() => {
    if (!ACCESS_KEY || !enabled) {
      if (isListening) stop().catch(() => {});
      return;
    }

    if (!isLoaded && !initStartedRef.current) {
      initStartedRef.current = true;
      setWakeWordError(null);
      init(
        ACCESS_KEY,
        [BuiltInKeyword.Jarvis],
        { publicPath: '/porcupine_params.pv', forceWrite: false },
      )
        .then(() => start())
        .catch((e) => {
          setWakeWordError(e);
          initStartedRef.current = false;
        });
    } else if (isLoaded && !isListening) {
      start().catch((e) => setWakeWordError(e));
    }
  }, [enabled, isLoaded, isListening, init, start, stop]);

  useEffect(() => {
    if (!enabled && isListening) {
      stop().catch(() => {});
    }
  }, [enabled, isListening, stop]);

  // Propagate SDK error
  useEffect(() => {
    if (error) setWakeWordError(error);
  }, [error]);

  useEffect(() => {
    if (keywordDetection?.label === 'Jarvis') {
      onWakeWordRef.current?.();
    }
  }, [keywordDetection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { release().catch(() => {}); };
  }, [release]);

  return {
    wakeWordReady: isLoaded && isListening,
    wakeWordError,
  };
}
