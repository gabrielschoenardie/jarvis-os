import { useState, useEffect } from 'react';

export function useTelemetry() {
  const [time, setTime] = useState(new Date());
  const [telemetry, setTelemetry] = useState({ load: 38, latency: 127, mem: 42 });

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setTelemetry(p => ({
        load: Math.max(22, Math.min(74, p.load + (Math.random() - 0.5) * 6)),
        latency: Math.max(94, Math.min(186, p.latency + (Math.random() - 0.5) * 12)),
        mem: Math.max(28, Math.min(68, p.mem + (Math.random() - 0.5) * 4)),
      }));
    }, 2400);
    return () => clearInterval(t);
  }, []);

  return { time, telemetry, setTelemetry };
}
