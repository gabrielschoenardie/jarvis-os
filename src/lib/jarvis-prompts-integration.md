# JARVIS Prompts — Integração com `chat.js`

Documento complementar ao `jarvis-prompts.js`. Mostra como integrar o módulo de prompts ao endpoint serverless e como testar o comando `/profundo`.

---

## 1. Arquitetura do módulo

```
src/lib/jarvis-prompts.js
├── 10 blocos modulares de prompt (identidade, domínio, estilo, etc.)
├── buildSystemPrompt({ deep, tools, memoryContext }) → compõe o prompt final
├── detectCommand(message) → extrai /comando do início da mensagem
└── resolveCommandConfig(command) → retorna { model, deep, badge }
```

**Princípio:** prompts não são monolíticos. Modo conversacional padrão usa só os blocos essenciais; modo profundo adiciona o bloco de raciocínio denso; Fase 4+ adiciona tools; Fase 5+ adiciona memória.

---

## 2. Integração no `api/chat.js` (Edge Function, Fase 0)

Versão refatorada do `chat.js` atual, agora consumindo o módulo de prompts:

```js
// api/chat.js
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

    // Detecta comando na última mensagem do usuário
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const { command, cleanMessage } = detectCommand(lastUserMsg?.content || '');
    const config = resolveCommandConfig(command);

    // Substitui a mensagem limpa (sem o /comando) no histórico
    const cleanedMessages = messages.map((m, i) => {
      if (m === lastUserMsg && cleanMessage !== lastUserMsg.content) {
        return { ...m, content: cleanMessage };
      }
      return m;
    });

    // Constrói system prompt com flags apropriadas
    const system = buildSystemPrompt({
      deep: config.deep,
      // tools: [] — será preenchido na Fase 4
      // memoryContext: null — será preenchido na Fase 5
    });

    // Chama Anthropic
    const upstreamResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
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
        model: config.model,
        elapsed_ms: Date.now() - t0,
      }));
      return new Response(errorBody, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Streaming: repassa o stream diretamente
    if (stream) {
      console.log(JSON.stringify({
        event: 'chat_stream_start',
        model: config.model,
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

    // Non-streaming: retorna JSON + metadata do comando
    const data = await upstreamResponse.json();
    console.log(JSON.stringify({
      event: 'chat_complete',
      model: config.model,
      command,
      tokens_in: data.usage?.input_tokens,
      tokens_out: data.usage?.output_tokens,
      total_ms: Date.now() - t0,
    }));

    // Inclui badge no response para o frontend mostrar
    return new Response(JSON.stringify({
      ...data,
      _jarvis: {
        command,
        badge: config.badge,
        model: config.model,
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
```

---

## 3. Mudanças necessárias no frontend (`App.jsx`)

### 3.1 Remover `JARVIS_SYSTEM` hardcoded

O `App.jsx` atual tem o system prompt embutido na constante `JARVIS_SYSTEM`. Agora ele vive no servidor (em `jarvis-prompts.js`). Frontend não precisa mais conhecê-lo.

**Remover** as linhas que definem `const JARVIS_SYSTEM = \`...\`` (linhas ~6-72 do `App.jsx` atual).

**Remover também** o campo `system` no body do fetch de `callClaude`:

```diff
  body: JSON.stringify({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1000,
-   system: JARVIS_SYSTEM,
    messages,
  }),
```

### 3.2 Mostrar badge quando modo profundo ativo

Após receber resposta, ler `data._jarvis?.badge` e mostrar visualmente:

```jsx
const [activeBadge, setActiveBadge] = useState(null);

// no submitCommand, após receber resposta:
if (data._jarvis?.badge) {
  setActiveBadge(data._jarvis.badge);
  setTimeout(() => setActiveBadge(null), 8000);
}

// no JSX, próximo ao input:
{activeBadge && (
  <div className="jv-fade" style={{
    fontSize: 9,
    letterSpacing: '0.32em',
    color: C.accent,
    border: `1px solid ${C.accent}`,
    padding: '4px 10px',
    marginBottom: 8,
    display: 'inline-block',
  }}>
    ◉ {activeBadge}
  </div>
)}
```

---

## 4. Teste manual após integração

### 4.1 Teste comando padrão (Sonnet 4.6)

```bash
curl -X POST https://SEU-PROJETO.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "explica VBV em uma frase" }
    ]
  }'
```

Esperado: resposta curta usando `claude-sonnet-4-5`. Verificar no log Vercel que `model` é Sonnet.

### 4.2 Teste comando profundo (Opus 4.7)

```bash
curl -X POST https://SEU-PROJETO.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "/profundo analise as implicações de psy-rd alto em conteúdo com grain natural vs grain sintético" }
    ]
  }'
```

Esperado:
- `model` no log é `claude-opus-4-7`
- Resposta tem profundidade analítica (não 1 parágrafo)
- `_jarvis.badge` = `"MODO PROFUNDO · OPUS 4.7"` no response

### 4.3 Verificação local com `vercel dev`

```bash
# Na raiz do projeto
npm install -g vercel
vercel dev

# Em outro terminal:
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"oi"}]}'
```

---

## 5. Checklist de validação da Fase 0 (relacionado a prompts)

- [ ] `src/lib/jarvis-prompts.js` criado e exportando funções corretas
- [ ] `api/chat.js` migrado para Edge Function com `export const config = { runtime: 'edge' }`
- [ ] `api/chat.js` consumindo `buildSystemPrompt()` ao invés de string hardcoded
- [ ] Comando `/profundo` detectado e roteia para Opus 4.7
- [ ] Log estruturado JSON em cada chamada (model, command, tokens, tempo)
- [ ] Frontend mostra badge "MODO PROFUNDO · OPUS 4.7" quando ativo
- [ ] Frontend não envia mais `system` no body — servidor é fonte da verdade
- [ ] Teste curl com `/profundo` retorna model correto no `_jarvis` metadata
- [ ] Teste curl sem comando usa Sonnet por default
- [ ] Latência de primeira resposta (não-streaming) <2s para mensagens curtas

---

## 6. Como ajustar o prompt no futuro

O design modular permite ajustes cirúrgicos:

- **Mudar tom de fala** → editar `JARVIS_STYLE` no `jarvis-prompts.js`
- **Adicionar conhecimento sobre nova spec do Instagram** → editar `JARVIS_DOMAIN_VIDEO`
- **Mudar comportamento do modo profundo** → editar `JARVIS_DEEP_MODE`
- **Adicionar novo comando especial** → adicionar entrada em `JARVIS_COMMANDS` + caso em `resolveCommandConfig()`
- **Mudar identidade fundamental** → editar `JARVIS_IDENTITY` (cuidado: muda tudo)

Cada bloco é independente e tem propósito único. Mudanças em um bloco não devem afetar comportamento dos outros.

---

*Documento complementar ao Roadmap v5.0 — Fase 0.*
