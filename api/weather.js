import { fetchForecast } from '../src/lib/weather.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const lat = req.headers.get('x-vercel-ip-latitude');
  const lon = req.headers.get('x-vercel-ip-longitude');
  const city = req.headers.get('x-vercel-ip-city');
  const country = req.headers.get('x-vercel-ip-country');

  if (!lat || !lon) {
    return new Response(JSON.stringify({ error: 'localização indisponível' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const forecast = await fetchForecast({ lat, lon });
    if (!forecast) {
      return new Response(JSON.stringify({ error: 'forecast indisponível' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ...forecast,
      city: city ? decodeURIComponent(city) : null,
      country: country || null,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
