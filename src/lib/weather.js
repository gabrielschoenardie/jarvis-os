// Termos que indicam pergunta sobre clima em PT-BR.
// "tempo" sozinho é ambíguo (tempo = duração) — só entra combinado em frases específicas.
// Todos os demais termos são checados como palavra inteira (evita "vento" casar em
// "aventura", "sol" em "resolver", "neve" em "chineve", etc).
const WEATHER_TERMS = [
  'clima', 'chuva', 'chover', 'chuvoso', 'garoa', 'pancada', 'aguaceiro',
  'temporal', 'tempestade', 'sol', 'ensolarado', 'nublado', 'nuvem', 'nuvens',
  'temperatura', 'graus', 'máxima', 'minima', 'mínima', 'maxima',
  'frio', 'calor', 'quente', 'vento', 'ventar', 'ventania', 'umidade', 'úmido', 'umido',
  'abafado', 'granizo', 'neve', 'nevar', 'geada', 'guarda-chuva',
];

const WEATHER_PHRASES = [
  'previsão do tempo', 'previsao do tempo', 'como está o tempo', 'como esta o tempo',
  'que tempo faz', 'tempo hoje', 'tempo amanhã', 'tempo amanha', 'tempo lá fora', 'tempo la fora',
];

function hasWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, 'iu').test(text);
}

export function isWeatherQuery(message) {
  if (!message || typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  if (WEATHER_TERMS.some(term => hasWord(lower, term))) return true;
  if (WEATHER_PHRASES.some(phrase => lower.includes(phrase))) return true;
  return false;
}

const WMO_CODE_PT = {
  0: 'céu limpo',
  1: 'poucas nuvens',
  2: 'parcialmente nublado',
  3: 'nublado',
  45: 'neblina',
  48: 'neblina com geada',
  51: 'garoa fraca',
  53: 'garoa moderada',
  55: 'garoa forte',
  56: 'garoa congelante fraca',
  57: 'garoa congelante forte',
  61: 'chuva fraca',
  63: 'chuva moderada',
  65: 'chuva forte',
  66: 'chuva congelante fraca',
  67: 'chuva congelante forte',
  71: 'neve fraca',
  73: 'neve moderada',
  75: 'neve forte',
  77: 'grãos de neve',
  80: 'pancadas de chuva fracas',
  81: 'pancadas de chuva moderadas',
  82: 'pancadas de chuva fortes',
  85: 'pancadas de neve fracas',
  86: 'pancadas de neve fortes',
  95: 'trovoada',
  96: 'trovoada com granizo fraco',
  99: 'trovoada com granizo forte',
};

function conditionText(code) {
  return WMO_CODE_PT[code] || 'condição indeterminada';
}

export async function fetchWeather({ lat, lon }) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=precipitation_probability_max,weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();

    const current = data.current;
    const daily = data.daily;
    if (!current || !daily) return null;

    return {
      tempC: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      windKmh: current.wind_speed_10m,
      conditionText: conditionText(current.weather_code),
      todayRainChance: daily.precipitation_probability_max?.[0] ?? null,
      todayConditionText: conditionText(daily.weather_code?.[0]),
      todayMaxC: daily.temperature_2m_max?.[0] ?? null,
      todayMinC: daily.temperature_2m_min?.[0] ?? null,
      tomorrowRainChance: daily.precipitation_probability_max?.[1] ?? null,
      tomorrowConditionText: conditionText(daily.weather_code?.[1]),
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Forecast completo de 7 dias + 48h horárias, para o card visual no chat.
// Retorna objeto 100% serializável (vai pro localStorage via histórico) ou null.
export async function fetchForecast({ lat, lon }) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=7`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();

    const { current, hourly, daily } = data;
    if (!current || !hourly || !daily) return null;

    return {
      current: {
        tempC: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        windKmh: current.wind_speed_10m,
        code: current.weather_code,
        conditionText: conditionText(current.weather_code),
      },
      hourly: (hourly.time || []).slice(0, 48).map((time, i) => ({
        time,
        tempC: hourly.temperature_2m?.[i] ?? null,
        rainChance: hourly.precipitation_probability?.[i] ?? null,
      })),
      daily: (daily.time || []).map((date, i) => ({
        date,
        code: daily.weather_code?.[i] ?? null,
        conditionText: conditionText(daily.weather_code?.[i]),
        maxC: daily.temperature_2m_max?.[i] ?? null,
        minC: daily.temperature_2m_min?.[i] ?? null,
        rainChance: daily.precipitation_probability_max?.[i] ?? null,
        windMaxKmh: daily.wind_speed_10m_max?.[i] ?? null,
      })),
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatWeatherContext(data, { city, country } = {}) {
  const location = city ? `${city}${country ? ', ' + country : ''}` : 'localização detectada por IP';

  const lines = [
    `Dados meteorológicos em tempo real para ${location}:`,
    `- Agora: ${data.tempC}°C, ${data.conditionText}, umidade ${data.humidity}%, vento ${data.windKmh} km/h`,
    `- Hoje: máxima ${data.todayMaxC}°C, mínima ${data.todayMinC}°C, condição prevista "${data.todayConditionText}", chance de chuva ${data.todayRainChance}%`,
  ];

  if (data.tomorrowRainChance != null) {
    lines.push(`- Amanhã: condição prevista "${data.tomorrowConditionText}", chance de chuva ${data.tomorrowRainChance}%`);
  }

  lines.push('(Fonte: Open-Meteo · dados podem ter até 15 min de defasagem)');

  return lines.join('\n');
}
