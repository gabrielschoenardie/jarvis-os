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

    const MAX_TURNS = 20;
    const truncated = cleanedMessages.length > MAX_TURNS * 2
      ? cleanedMessages.slice(-MAX_TURNS * 2)
      : cleanedMessages;

    const upstreamResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: cmdConfig.model,
        max_tokens: 4096,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: truncated,
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

      let inputTokens = 0, outputTokens = 0;
      let sseLineBuffer = '';
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const { readable, writable } = new TransformStream({
        transform(chunk, controller) {
          sseLineBuffer += decoder.decode(chunk, { stream: true });
          const lines = sseLineBuffer.split('\n');
          sseLineBuffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const json = line.slice(6).trim();
              if (json !== '[DONE]') {
                try {
                  const ev = JSON.parse(json);
                  if (ev.type === 'message_start') {
                    inputTokens = ev.message?.usage?.input_tokens ?? 0;
                  } else if (ev.type === 'message_delta' && ev.usage) {
                    outputTokens = ev.usage.output_tokens ?? 0;
                  }
                } catch (_) {}
              }
            }
            controller.enqueue(encoder.encode(line + '\n'));
          }
        },
        flush(controller) {
          if (sseLineBuffer) controller.enqueue(encoder.encode(sseLineBuffer + '\n'));
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'jarvis_tokens', input: inputTokens, output: outputTokens })}\n\n`
          ));
        },
      });

      upstreamResponse.body.pipeTo(writable);

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Jarvis-Meta': JSON.stringify({ command, badge: cmdConfig.badge, model: cmdConfig.model }),
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
