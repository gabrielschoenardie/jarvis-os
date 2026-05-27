import { useState, useEffect } from 'react';

export function useTelemetry() {
  const [time, setTime] = useState(new Date());
  const [telemetry, setTelemetry] = useState({ latency: 0, mem: null });

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

  return { time, telemetry, setTelemetry };
}
