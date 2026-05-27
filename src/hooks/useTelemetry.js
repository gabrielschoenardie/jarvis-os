import { useState, useEffect, useRef, useCallback } from 'react';

export function useTelemetry() {
  const [time, setTime] = useState(new Date());
  const [telemetry, setTelemetry] = useState(() => {
    const memType = performance.memory ? 'heap'
      : navigator.deviceMemory ? 'device'
      : null;
    const mem = performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100)
      : navigator.deviceMemory ?? null;
    return { latency: 0, mem, memType };
  });

  const liveTimerRef = useRef(null);
  const t0Ref = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date());
      if (performance.memory) {
        setTelemetry(p => ({
          ...p,
          mem: Math.round(performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100),
        }));
      }
    }, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => { if (liveTimerRef.current) clearInterval(liveTimerRef.current); };
  }, []);

  const startTimer = useCallback(() => {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    t0Ref.current = Date.now();
    liveTimerRef.current = setInterval(() => {
      setTelemetry(p => ({ ...p, latency: Date.now() - t0Ref.current }));
    }, 100);
  }, []);

  const stopTimer = useCallback((finalMs) => {
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    setTelemetry(p => ({ ...p, latency: Math.round(finalMs * 0.4 + p.latency * 0.6) }));
  }, []);

  return { time, telemetry, setTelemetry, startTimer, stopTimer };
}
