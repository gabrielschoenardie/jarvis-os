import { buildSystemPrompt, detectCommand, resolveCommandConfig } from '../src/lib/jarvis-prompts.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    const { messages, stream = false } = body;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const { command, cleanMessage } = detectCommand(lastUserMsg?.content || '');
    const cmdConfig = resolveCommandConfig(command);

    const cleanedMessages = messages.map(m => {
      if (m === lastUserMsg && cleanMessage !== lastUserMsg.content) {
        return { ...m, content: cleanMessage };
      }
      return m;
    });

    const system = buildSystemPrompt({
      deep: cmdConfig.deep,
      // tools: [] — Fase 4
      // memoryContext: null — Fase 5
    });

    const upstreamResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cmdConfig.model,
        max_tokens: 4096,
        system,
        messages: cleanedMessages,
        stream,
      }),
    });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      console.error(JSON.stringify({
        event: 'anthropic_error',
        status: upstreamResponse.status,
        body: errorBody.substring(0, 500),
        model: cmdConfig.model,
        elapsed_ms: Date.now() - t0,
      }));
      return new Response(errorBody, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (stream) {
      console.log(JSON.stringify({
        event: 'chat_stream_start',
        model: cmdConfig.model,
        command,
        ttfb_ms: Date.now() - t0,
      }));
      return new Response(upstreamResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    const data = await upstreamResponse.json();
    console.log(JSON.stringify({
      event: 'chat_complete',
      model: cmdConfig.model,
      command,
      tokens_in: data.usage?.input_tokens,
      tokens_out: data.usage?.output_tokens,
      total_ms: Date.now() - t0,
    }));

    return new Response(JSON.stringify({
      ...data,
      _jarvis: {
        command,
        badge: cmdConfig.badge,
        model: cmdConfig.model,
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(JSON.stringify({
      event: 'handler_error',
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 3),
      elapsed_ms: Date.now() - t0,
    }));
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
