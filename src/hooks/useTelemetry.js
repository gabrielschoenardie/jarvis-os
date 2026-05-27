import { useState, useEffect, useRef, useCallback } from 'react';

export function useTelemetry() {
  const [time, setTime] = useState(new Date());
  const [telemetry, setTelemetry] = useState({ latency: 0 });

  const liveTimerRef = useRef(null);
  const t0Ref = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date());
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
