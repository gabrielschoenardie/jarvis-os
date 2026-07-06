import { buildSystemPrompt, detectCommand, resolveCommandConfig, JARVIS_WEATHER_INTRO } from '../src/lib/jarvis-prompts.js';
import { isWeatherQuery, fetchWeather, formatWeatherContext } from '../src/lib/weather.js';
import { extractMessageText, replaceMessageText, stripImageAttachment } from '../src/lib/attachments.js';
import { JARVIS_TOOLS, TOOL_NAMES, executeTool } from '../src/lib/jarvis-tools.js';

export const config = { runtime: 'edge' };

// Guarda contra loops infinitos de tool-use dentro de um único request.
const MAX_ITERATIONS = 5;

function callAnthropic(apiKey, body) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    // tools SEMPRE incluídas (nunca condicionais) — na hierarquia de prompt
    // caching, tools vêm antes de system; variar o array por request
    // invalidaria o cache do bloco de identidade a cada mudança.
    body: JSON.stringify({ ...body, tools: JARVIS_TOOLS }),
  });
}

// Lê o SSE upstream da Anthropic linha a linha, encaminha TODA linha crua
// inalterada ao cliente (via forwardLine) e reconstrói os content blocks da
// mensagem em andamento — necessário para reenviar o turno do assistant quando
// stop_reason é tool_use/pause_turn.
async function pumpMessage(body, forwardLine) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const blocks = [];
  const partialJson = {};
  let stopReason = null;
  const usage = { input: 0, output: 0 };

  const handleLine = (line) => {
    forwardLine(line);
    if (!line.startsWith('data: ')) return;
    const json = line.slice(6).trim();
    if (!json || json === '[DONE]') return;
    let ev;
    try { ev = JSON.parse(json); } catch (_) { return; }

    if (ev.type === 'message_start') {
      usage.input += ev.message?.usage?.input_tokens ?? 0;
    } else if (ev.type === 'content_block_start') {
      const b = { ...ev.content_block };
      if (b.type === 'text') b.text = b.text || '';
      // tool_use/server_tool_use: o input chega fragmentado via input_json_delta
      if (b.type === 'tool_use' || b.type === 'server_tool_use') partialJson[ev.index] = '';
      blocks[ev.index] = b;
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index];
      if (!b) return;
      if (ev.delta?.type === 'text_delta') {
        b.text += ev.delta.text;
      } else if (ev.delta?.type === 'input_json_delta') {
        partialJson[ev.index] += ev.delta.partial_json;
      } else if (ev.delta?.type === 'citations_delta' && ev.delta.citation) {
        b.citations = b.citations || [];
        b.citations.push(ev.delta.citation);
      }
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b && partialJson[ev.index] !== undefined) {
        try {
          b.input = partialJson[ev.index] ? JSON.parse(partialJson[ev.index]) : {};
        } catch (_) {
          // JSON truncado (ex: max_tokens no meio do tool_use) — marca como
          // inutilizável; o loop encerra sem executar.
          b._malformed = true;
        }
        delete partialJson[ev.index];
      }
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
      if (ev.usage?.output_tokens != null) usage.output = ev.usage.output_tokens;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  return { content: blocks.filter(Boolean), stopReason, usage };
}

// Prepara os blocos reconstruídos para reenvio como turno do assistant:
// remove flags internas e blocos de texto vazios (a API rejeita text: '').
function sanitizeBlocks(blocks) {
  return blocks
    .filter(b => !(b.type === 'text' && !b.text))
    .map(({ _malformed, ...b }) => b);
}

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
    const lastUserText = extractMessageText(lastUserMsg?.content);
    const { command, cleanMessage } = detectCommand(lastUserText || '');
    const cmdConfig = resolveCommandConfig(command);

    const cleanedMessages = messages.map(m => {
      if (m === lastUserMsg && cleanMessage !== lastUserText) {
        return { ...m, content: replaceMessageText(m.content, cleanMessage) };
      }
      return m;
    });

    // Só a última mensagem do usuário pode carregar imagem/documento em anexo —
    // turnos anteriores são comprimidos pro texto (com o marcador "[Anexo: ...]"
    // preservado), evitando pagar reprocessamento de imagem em toda mensagem
    // subsequente da mesma sessão.
    const compactedMessages = cleanedMessages.map(m =>
      m === lastUserMsg ? m : { ...m, content: stripImageAttachment(m.content) }
    );

    let weatherBlockText = null;
    if (isWeatherQuery(cleanMessage)) {
      const lat = req.headers.get('x-vercel-ip-latitude');
      const lon = req.headers.get('x-vercel-ip-longitude');
      const city = req.headers.get('x-vercel-ip-city');
      const country = req.headers.get('x-vercel-ip-country');
      if (lat && lon) {
        try {
          const weatherData = await fetchWeather({ lat, lon });
          if (weatherData) {
            weatherBlockText = JARVIS_WEATHER_INTRO + '\n\n' + formatWeatherContext(weatherData, {
              city: city ? decodeURIComponent(city) : null,
              country,
            });
          }
        } catch (_) { /* silencioso — cai no guardrail de "sem acesso em tempo real" */ }
      }
    }

    const system = buildSystemPrompt({
      deep: cmdConfig.deep,
      tools: TOOL_NAMES,
      // memoryContext: null — Fase 5
    });

    const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (weatherBlockText) systemBlocks.push({ type: 'text', text: weatherBlockText });

    const MAX_TURNS = 20;
    const truncated = compactedMessages.length > MAX_TURNS * 2
      ? compactedMessages.slice(-MAX_TURNS * 2)
      : compactedMessages;

    const baseBody = {
      model: cmdConfig.model,
      max_tokens: 4096,
      system: systemBlocks,
    };

    // A PRIMEIRA chamada acontece antes de construir a Response — erros dela
    // (429, 401...) voltam como status HTTP real, preservando o backoff do
    // cliente. Erros nas chamadas seguintes do loop (headers já enviados)
    // viram um evento SSE sintético {type:'error'}.
    const upstreamResponse = await callAnthropic(apiKey, { ...baseBody, messages: truncated, stream });

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

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const send = obj => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          const forward = line => controller.enqueue(encoder.encode(line + '\n'));

          let msgs = truncated;
          let totalIn = 0, totalOut = 0;
          let upstream = upstreamResponse;
          let producedText = false;

          try {
            for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
              if (iter > 0) {
                upstream = await callAnthropic(apiKey, { ...baseBody, messages: msgs, stream: true });
                if (!upstream.ok) {
                  const errBody = await upstream.text();
                  console.error(JSON.stringify({
                    event: 'anthropic_error_mid_loop',
                    status: upstream.status,
                    body: errBody.substring(0, 300),
                    iter,
                  }));
                  send({ type: 'error', error: { message: `núcleo retornou ${upstream.status} durante execução de ferramenta` } });
                  break;
                }
                // Quebra de parágrafo sintética entre fases do loop — evita que
                // a última frase pré-tool e a primeira pós-tool se emendem no
                // texto exibido e no chunker de TTS.
                if (producedText) {
                  send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '\n\n' } });
                }
              }

              const { content, stopReason, usage } = await pumpMessage(upstream.body, forward);
              totalIn += usage.input;
              totalOut += usage.output;
              if (content.some(b => b.type === 'text' && b.text.trim())) producedText = true;

              const toolUses = content.filter(b => b.type === 'tool_use');

              if (stopReason === 'tool_use' && toolUses.length && !toolUses.some(b => b._malformed)) {
                msgs = [...msgs, { role: 'assistant', content: sanitizeBlocks(content) }];
                // Todos os tool_result do turno vão em UMA única mensagem user
                // (exigência da API para tool_use paralelo).
                const results = [];
                for (const tu of toolUses) {
                  send({ type: 'jarvis_tool', name: tu.name, status: 'start' });
                  const toolT0 = Date.now();
                  const { resultText, isError, action } = await executeTool(tu.name, tu.input || {});
                  console.log(JSON.stringify({
                    event: 'jarvis_tool_exec',
                    name: tu.name,
                    iter,
                    is_error: isError,
                    elapsed_ms: Date.now() - toolT0,
                  }));
                  if (action) send({ type: 'jarvis_action', ...action });
                  results.push({
                    type: 'tool_result',
                    tool_use_id: tu.id,
                    content: resultText,
                    ...(isError ? { is_error: true } : {}),
                  });
                  send({ type: 'jarvis_tool', name: tu.name, status: 'done' });
                }
                msgs = [...msgs, { role: 'user', content: results }];
                continue;
              }

              if (stopReason === 'pause_turn') {
                // Busca web longa: ecoar os blocos do assistant de volta
                // (inclusive web_search_tool_result) e re-chamar, sem tool_result.
                msgs = [...msgs, { role: 'assistant', content: sanitizeBlocks(content) }];
                continue;
              }

              break; // end_turn / max_tokens / stop_sequence / tool_use malformado
            }
          } catch (err) {
            console.error(JSON.stringify({
              event: 'stream_loop_error',
              message: err.message,
              stack: err.stack?.split('\n').slice(0, 3),
            }));
            send({ type: 'error', error: { message: err.message } });
          } finally {
            send({ type: 'jarvis_tokens', input: totalIn, output: totalOut });
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Jarvis-Meta': JSON.stringify({ command, badge: cmdConfig.badge, model: cmdConfig.model }),
        },
      });
    }

    // Caminho não-streaming: mesmo loop agêntico, sem SSE.
    let msgs = truncated;
    let totalIn = 0, totalOut = 0;
    const textParts = [];
    const actions = [];
    let data = await upstreamResponse.json();

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (iter > 0) {
        const res = await callAnthropic(apiKey, { ...baseBody, messages: msgs, stream: false });
        if (!res.ok) {
          const errorBody = await res.text();
          return new Response(errorBody, {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        data = await res.json();
      }
      totalIn += data.usage?.input_tokens ?? 0;
      totalOut += data.usage?.output_tokens ?? 0;
      textParts.push(...(data.content || []).filter(b => b.type === 'text' && b.text.trim()).map(b => b.text));

      const toolUses = (data.content || []).filter(b => b.type === 'tool_use');
      if (data.stop_reason === 'tool_use' && toolUses.length) {
        msgs = [...msgs, { role: 'assistant', content: data.content }];
        const results = [];
        for (const tu of toolUses) {
          const { resultText, isError, action } = await executeTool(tu.name, tu.input || {});
          if (action) actions.push(action);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText, ...(isError ? { is_error: true } : {}) });
        }
        msgs = [...msgs, { role: 'user', content: results }];
        continue;
      }
      if (data.stop_reason === 'pause_turn') {
        msgs = [...msgs, { role: 'assistant', content: data.content }];
        continue;
      }
      break;
    }

    console.log(JSON.stringify({
      event: 'chat_complete',
      model: cmdConfig.model,
      command,
      tokens_in: totalIn,
      tokens_out: totalOut,
      total_ms: Date.now() - t0,
    }));

    return new Response(JSON.stringify({
      ...data,
      content: [{ type: 'text', text: textParts.join('\n\n') }],
      usage: { input_tokens: totalIn, output_tokens: totalOut },
      _jarvis: {
        command,
        badge: cmdConfig.badge,
        model: cmdConfig.model,
        actions,
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
