import { useState, useEffect, useRef, useCallback } from 'react';

// Telemetria. A latência ao vivo (tick de 100ms) NÃO passa mais por estado
// React — ela é empurrada a assinantes via callback, então só o componente-
// folha que exibe o número re-renderiza. Antes o tick subia até o App e
// re-renderizava a árvore inteira 10×/s durante cada requisição.
export function useTelemetry() {
  const [time, setTime] = useState(new Date());

  const latencyRef = useRef(0);
  const listenersRef = useRef(new Set());
  const liveTimerRef = useRef(null);
  const t0Ref = useRef(null);

  // Relógio do cabeçalho (2s) — fora do caminho quente do streaming.
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => { if (liveTimerRef.current) clearInterval(liveTimerRef.current); };
  }, []);

  const emit = useCallback((v) => {
    latencyRef.current = v;
    listenersRef.current.forEach((cb) => cb(v));
  }, []);

  const startTimer = useCallback(() => {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    t0Ref.current = Date.now();
    liveTimerRef.current = setInterval(() => {
      emit(Date.now() - t0Ref.current);
    }, 100);
  }, [emit]);

  const stopTimer = useCallback((finalMs) => {
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    // EMA idêntica à anterior, mas usando o último valor ao vivo do ref.
    emit(Math.round(finalMs * 0.4 + latencyRef.current * 0.6));
  }, [emit]);

  // Assina o valor de latência; retorna o unsubscribe. Referência estável.
  const subscribeLatency = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  const getLatency = useCallback(() => latencyRef.current, []);

  return { time, startTimer, stopTimer, subscribeLatency, getLatency };
}
