# Plano de Implementação — JARVIS OS

## Fase A.1 — Retrieval Refinement: contexto semântico preciso, rastreável e sem regressões

> - **Executor:** Claude Code no VS Code
> - **Repositório:** `gabrielschoenardie/jarvis-os`
> - **Branch alvo:** `main`
> - **Objetivo:** melhorar a qualidade do retrieval semântico atualmente implementado, preservando toda a arquitetura existente.
>
> **IMPORTANTE:** este plano NÃO troca o modelo de embeddings, NÃO implementa o Plano B/R2 e NÃO deve alterar a arquitetura de sync. O modelo permanece definitivamente nesta fase como:
>
> `Xenova/multilingual-e5-small`
>
> quantizado `q8`, `384 dimensões`, execução local via `@huggingface/transformers` + `onnxruntime-web`.

---

## 1. Contexto atual — NÃO REFAZER

Antes de alterar qualquer coisa, leia e entenda a implementação atual dos arquivos:

```text
src/hooks/useVault.js
src/hooks/useVaultIndex.js

src/lib/chunker.js
src/lib/vectorIndex.js
src/lib/embedder.js
src/lib/memoryContext.js
src/lib/anthropic.js
src/lib/jarvis-prompts.js

src/workers/embedder.worker.js

src/hooks/useChat.js

src/components/MemoryPanel.jsx

api/chat.js

docs/HYBRID_MEMORY_PLAN.md
```

Também leia os testes existentes relacionados a:

```text
memory
vault
embedding
chunk
vector
chat
```

e leia o `CLAUDE.md` antes de modificar o projeto.

### Não faça uma reimplementação da memória

A Fase A já existe e está funcionando.

O sistema atual possui:

```text
Obsidian Vault
    ↓
scan incremental
    ↓
diff por mtime
    ↓
chunking
    ↓
E5 Small Q8
    ↓
384D normalized embeddings
    ↓
IndexedDB
    ↓
semantic retrieval
    ↓
hybrid score cosine + recency
    ↓
dedupe por nota
    ↓
memoryContext
    ↓
/api/chat
    ↓
Claude
```

Essa arquitetura deve permanecer.

---

## 2. Decisões arquiteturais congeladas

NÃO alterar:

### Modelo

```text
Xenova/multilingual-e5-small
```

### Dimensão

```text
384
```

### Quantização

```text
q8
```

### Prefixos E5

Para documentos:

```text
passage: ...
```

Para consultas:

```text
query: ...
```

### Pooling

```text
mean
```

### Normalização

```text
normalize: true
```

### Runtime

```text
@huggingface/transformers
onnxruntime-web
Web Worker
```

### Persistência

```text
IndexedDB
```

### Escopo

100% local para indexação e embeddings.

### Plano B / Cloudflare R2

**NÃO IMPLEMENTAR NADA DO PLANO B NESTA TAREFA.**

Não criar:

```text
presigned URLs
R2 sync
memory-sync
upload/download de índice
AWS SigV4
aws4fetch
criptografia de sync
```

O Plano B continuará apenas como planejamento futuro.

---

## 3. Problema que esta fase deve corrigir

A implementação atual recupera corretamente um chunk por similaridade semântica, mas existe uma perda de informação no momento em que o conteúdo recuperado é transformado em contexto para o Claude.

Hoje existe conceitualmente:

```text
query
 ↓
embedding
 ↓
chunk relevante ≈ 900 chars
 ↓
memoryContext
 ↓
excerpt(content, 400)
 ↓
primeiros 400 caracteres
```

Isso é inadequado.

O embedding pode identificar corretamente um chunk porque a informação importante está no meio ou no final dele, mas `memoryContext.js` atualmente pode enviar ao Claude apenas os primeiros 400 caracteres.

### Objetivo principal desta fase

Garantir:

> **O conteúdo que venceu semanticamente precisa ser o conteúdo que efetivamente chega ao Claude.**

E o MemoryPanel deve refletir exatamente isso.

---

## 4. Objetivos da Fase A.1

Implementar:

### A. Preservar o trecho relevante

Não truncar cegamente sempre pelos primeiros 400 caracteres.

### B. Preservar contexto

Ao selecionar um chunk semântico, manter o máximo de contexto útil dentro do orçamento atual.

### C. Preservar compatibilidade

Não aumentar indiscriminadamente o payload enviado ao Claude.

O teto de:

```text
MAX_TOTAL_CHARS = 2000
```

deve continuar existindo.

### D. Melhorar o contexto sem mudar o modelo

Nenhuma alteração no E5 Small.

### E. Melhorar metadata sem quebrar o índice existente

Os chunks devem passar a carregar contexto estrutural suficiente para melhorar retrieval futuro.

### F. Tornar retrieval observável

Ser possível descobrir:

```text
qual nota venceu
qual chunk venceu
qual score teve
qual seção/heading estava associada
qual texto realmente foi enviado ao Claude
```

### G. MemoryPanel deve representar o prompt real

O painel não pode mostrar um conteúdo diferente daquele enviado ao Claude.

---

## 5. Regra crítica: compatibilidade com o índice existente

O projeto possui índice persistido no IndexedDB:

```text
jarvis-vault-index
```

Atualmente ele contém aproximadamente:

```js
{
  version,
  model,
  dims,
  updatedAt,
  notes,
  chunks,
  vectors
}
```

A implementação deve ser retrocompatível o suficiente para não causar crash caso exista índice antigo.

Como haverá mudança no formato dos chunks/metadados, é aceitável invalidar e reconstruir o índice.

### Recomendo

alterar:

```js
version: 1
```

para:

```js
version: 2
```

ou utilizar uma constante explícita:

```js
const INDEX_VERSION = 2;
```

e validar junto com:

```js
saved.version === INDEX_VERSION
saved.model === MODEL_ID
saved.dims === DIMS
```

Se incompatível:

```text
descartar índice
↓
reindexar com segurança
```

### Não apagar o banco IndexedDB inteiro

Invalidar apenas o índice do JARVIS.

---

## 6. Melhoria 1 — Structural Metadata nos chunks

O atual `chunker.js` trabalha essencialmente sobre texto linear.

Evoluir o chunking para manter metadata estrutural.

Cada chunk deve poder representar algo próximo de:

```js
{
  path,
  title,
  heading,
  headingPath,
  chunkIndex,
  text
}
```

Onde:

### `title`

Título da nota.

### `heading`

Heading principal associado ao chunk.

### `headingPath`

Hierarquia completa.

Exemplo:

```text
Fase A > A5. Retrieval passa a ser por request
```

### `chunkIndex`

Índice do chunk dentro da nota.

### `text`

Conteúdo textual real.

Não tornar o parser Markdown excessivamente complexo nesta fase.

---

## 7. Atenção ao chunking

Não destrua o comportamento existente de:

```text
~900 chars
~150 chars overlap
```

Essa configuração continua como baseline.

A evolução deve ser estrutural, não uma troca radical.

Continue priorizando:

```text
parágrafo
↓
heading
↓
hard cut
```

na mesma filosofia atual.

Evitar:

- dependência nova pesada;
- parser externo apenas para headings;
- mudanças de comportamento inesperadas em listas;
- quebrar testes existentes.

---

## 8. Melhoria 2 — embedding com contexto estrutural

Atualmente o embedding recebe essencialmente:

```text
passage: conteúdo do chunk
```

Preferir:

```text
passage: Título da nota
Seção: headingPath

conteúdo do chunk
```

Exemplo:

```text
passage: Vault Brain Híbrido
Seção: Fase A > A5. Retrieval passa a ser por request

A busca semântica passa a acontecer por mensagem...
```

### Importante

O texto exibido ao Claude não precisa ser igual ao texto usado para embedding.

Podem existir:

```js
embeddingText
```

e:

```js
displayText
```

Exemplo:

```js
{
  title,
  headingPath,
  text,
  embeddingText
}
```

---

## 9. Não quebrar E5

Continue usando o mesmo worker:

```text
src/workers/embedder.worker.js
```

com:

```js
`${prefix}: ${text}`
```

e:

```js
pooling: 'mean'
normalize: true
```

A única evolução deve ser o conteúdo entregue ao `passage:`.

---

## 10. Melhoria 3 — Retrieval deve preservar o chunk real

No `vectorIndex.js`, `search()` atualmente retorna:

```js
{
  path,
  text,
  score
}
```

Evoluir para retornar metadata suficiente:

```js
{
  path,
  title,
  heading,
  headingPath,
  chunkIndex,
  text,
  score
}
```

Sem remover nenhum campo atual que outros componentes utilizem.

### Regra

Não quebrar consumidores existentes.

---

## 11. Melhoria 4 — Não usar mais `slice(0, 400)` cegamente

O `memoryContext.js` possui:

```text
MAX_EXCERPT_CHARS = 400
```

e atualmente pode fazer:

```js
body.slice(0, max)
```

Isso precisa ser corrigido.

### Criar uma função dedicada

Algo conceitualmente parecido com:

```js
buildRelevantExcerpt(text, options)
```

A função deve ser determinística.

### Primeira prioridade

Se:

```text
text.length <= 400
```

usar o chunk inteiro.

### Segunda prioridade

Se o chunk for maior:

- preservar headings/contexto quando disponíveis;
- preferir fronteiras de parágrafo;
- preferir fronteiras de frase;
- evitar cortar palavra;
- respeitar o orçamento global.

### Terceira prioridade

Se precisar truncar, usar uma janela composta ou outra estratégia simples e testável, em vez de sempre pegar o início.

Não inventar uma falsa localização semântica dentro do chunk, já que o embedding atual não fornece token/span offsets.

---

## 12. Regra importante para chunks pequenos

Se o chunk tem:

```text
600 caracteres
```

e existe orçamento de:

```text
2000
```

não reduzi-lo artificialmente para 400.

O limite de 2000 é global.

O sistema deve maximizar a informação relevante dentro dele.

---

## 13. Novo algoritmo de montagem do contexto

Reestruturar `selectParts()` para:

```text
entries semânticas
        ↓
ordem por score
        ↓
para cada entry
        ↓
montar representação contextual
        ↓
se cabe no orçamento:
    aceita
senão:
    tenta versão reduzida
senão:
    para
```

O orçamento continua:

```text
MAX_TOTAL_CHARS = 2000
```

A regra é:

> usar o máximo de informação relevante possível dentro de 2000 caracteres.

---

## 14. Melhorar o rótulo do contexto

Atualmente o texto pode dizer:

```text
Notas recentes do vault (mais recentes primeiro):
```

Isso é inadequado quando o retrieval foi semântico.

Criar labels distintos.

### Semântico

```text
Contexto relevante recuperado do vault:
```

### Fallback de recência

```text
Notas recentes do vault:
```

Não mencionar "recentes" quando a origem for semanticamente recuperada.

---

## 15. MemoryContext deve saber o modo

Evoluir de modo compatível:

```js
buildMemoryContext(entries, { mode = 'recency' })
```

ou equivalente.

A chamada antiga:

```js
buildMemoryContext(entries)
```

deve continuar funcionando.

---

## 16. MemoryDetail deve refletir o mesmo conteúdo real

A boa propriedade atual de compartilhar a lógica entre:

```text
buildMemoryDetail()
buildMemoryContext()
```

deve ser preservada.

### Regra absoluta

Não duplicar lógica de seleção.

A mesma estrutura de `parts` deve alimentar:

```text
prompt
+
MemoryPanel
```

Assim o MemoryPanel é uma representação visual do que realmente foi enviado.

---

## 17. MemoryPanel — melhorar observabilidade

O `MemoryPanel` já mostra:

```text
título
tokens estimados
score
excerpt
```

Preservar isso.

Adicionar, sem poluir visualmente:

```text
heading / seção
```

quando disponível.

Exemplo:

```text
Vault Brain Híbrido
Fase A > A5. Retrieval...
≈112 tok · 0.87
```

Se couber sem degradar a UI, mostrar também:

```text
chunk 3/8
```

Isso será útil para depuração.

---

## 18. Melhorar `useVault.searchMemory()`

A função deve continuar:

```text
query
↓
semantic search
↓
fallback
↓
memoryDetail
↓
memoryContext
```

Mas os `entries` devem carregar metadata adicional quando disponíveis.

Exemplo semântico:

```js
{
  title,
  path,
  heading,
  headingPath,
  chunkIndex,
  content,
  score
}
```

Fallback:

```js
{
  title,
  path,
  content,
  score: undefined
}
```

Isso mantém compatibilidade.

---

## 19. Score híbrido — NÃO alterar agressivamente

Hoje existe aproximadamente:

```text
0.75 cosine
0.25 recency
```

Não trocar automaticamente para 90/10 ou 95/5 nesta tarefa.

O objetivo desta fase é corrigir contexto e rastreabilidade primeiro.

Preservar:

```js
COSINE_WEIGHT
RECENCY_WEIGHT
```

com os valores atuais.

---

## 20. Retrieval candidates

Não trocar imediatamente o mecanismo por ANN, reranker externo ou banco vetorial.

A busca atual continua sendo a baseline.

Se fizer uma pequena melhoria estrutural, apenas separar conceitualmente:

```text
vector candidate retrieval
        ↓
hybrid scoring
        ↓
dedupe
        ↓
context selection
```

sem alterar desnecessariamente o comportamento atual.

---

## 21. Privacidade

Não introduzir novos envios externos.

O embedding continua:

```text
100% local
```

Não criar:

- API externa de embeddings;
- telemetria externa;
- logs com conteúdo completo do Vault;
- envio de chunks para debug remoto.

A única informação do Vault que sai do browser continua sendo o contexto selecionado para o prompt do Claude.

---

## 22. Memory Trace — observabilidade segura

Criar observabilidade suficiente para depuração, sem expor conteúdo sensível.

Algo conceitualmente parecido com:

```js
{
  mode,
  query,
  candidates,
  selected,
  totalChars,
  totalTokens
}
```

Pode registrar:

```text
path
title
score
chunkIndex
char counts
mode
```

Não registrar o conteúdo completo das notas no console.

Preferencialmente manter o trace em memória ou expô-lo por uma interface futura.

---

## 23. Testes obrigatórios

Criar/atualizar testes para:

### Teste 1 — chunk curto

Entrada curta deve retornar o texto inteiro.

### Teste 2 — chunk > 400

Garantir que não seja simplesmente `text.slice(0,400)` quando existir uma estratégia melhor.

### Teste 3 — chunk abaixo do limite global

Uma entrada de 600 chars deve poder usar os 600 completos quando houver orçamento.

### Teste 4 — múltiplas notas

Garantir sempre:

```text
totalChars <= 2000
```

### Teste 5 — truncamento

Evitar cortar palavras quando houver uma fronteira próxima adequada.

### Teste 6 — modo semantic

Garantir que o contexto semântico não seja rotulado como "Notas recentes".

### Teste 7 — modo recency

Garantir que o fallback continue funcionando.

### Teste 8 — metadata

Garantir:

```text
title
heading
headingPath
chunkIndex
text
```

quando disponíveis.

### Teste 9 — índice incompatível

Garantir que `version` antiga provoque invalidação/reindexação segura.

### Teste 10 — MemoryPanel

Garantir que o detalhe represente o mesmo conteúdo usado no contexto.

---

## 24. Validação obrigatória — respeitar os scripts reais do projeto

Antes de executar comandos, leia `CLAUDE.md` e confirme os scripts disponíveis no `package.json`.

Na `main` atual, o `CLAUDE.md` informa que **não existem scripts de lint ou test**. Portanto, não inventar comandos como `npm test` ou `npm run lint:design`.

Executar obrigatoriamente:

```bash
npm run build
git diff --check
git status
```

Se existirem testes Node independentes já presentes no repositório, executá-los conforme a estrutura real encontrada.

Se o projeto passar a ter scripts de teste/lint durante esta tarefa, usar os scripts reais definidos no `package.json`.

Não considerar concluído se o build falhar ou se `git diff --check` detectar problemas.

---

## 25. Verificação funcional manual

Após implementar:

1. conectar um Vault real;
2. aguardar `ÍNDICE → ready`;
3. fazer uma pergunta sobre uma nota antiga;
4. abrir o MemoryPanel;
5. confirmar:
   - nota correta;
   - score;
   - heading;
   - trecho;
   - caracteres;
6. confirmar que o MemoryPanel corresponde ao contexto efetivamente gerado;
7. confirmar que Claude consegue responder com base naquele contexto.

---

## 26. Cenários reais

Testar perguntas como:

```text
Como funciona a memória semântica do JARVIS?
```

```text
Por que o E5 Small foi escolhido?
```

```text
Como a indexação incremental funciona?
```

```text
Qual é o papel do IndexedDB no JARVIS?
```

```text
Como o sistema faz fallback quando o embedding falha?
```

```text
Como o Web Worker foi utilizado no embedder?
```

Para cada uma, verificar:

```text
pergunta
↓
resultados
↓
resultado final
↓
MemoryPanel
↓
contexto real
↓
Claude
```

---

## 27. Não implementar funcionalidades futuras

Nesta tarefa NÃO implementar:

```text
modelo Base
modelo Large
modelo PT-BR alternativo
Cloudflare R2
sync entre dispositivos
reranker externo
ANN
banco vetorial externo
embeddings server-side
mudança do provider Claude
alteração do modelo Claude
```

---

## 28. Não quebrar Capture e Chat

Preservar:

```text
chatCapture.js
00-Inbox
localStorage
apiHistory
history
streaming
TTS
tools
tool-use loop
weather
attachments
429 retry
token usage
HUD
actions
```

A melhoria do retrieval não deve alterar o mecanismo de captura ou o fluxo normal do chat.

---

## 29. Não alterar `api/chat.js` desnecessariamente

A menos que seja estritamente necessário para receber o `memoryContext` melhor formado, manter o servidor intacto.

O foco desta fase está em:

```text
chunking
index metadata
retrieval result
memoryContext
MemoryPanel
testes
```

---

## 30. Resultado esperado

A arquitetura final deverá permanecer:

```text
                    OBSIDIAN VAULT
                           │
                           ▼
                    incremental scan
                           │
                           ▼
                     structural chunk
                           │
                 ┌─────────┴─────────┐
                 │                   │
            metadata             content
                 │                   │
                 └─────────┬─────────┘
                           ▼
                     E5 Small Q8
                       384D
                           │
                           ▼
                      IndexedDB
                           │
                           ▼
                         QUERY
                           │
                           ▼
                      E5 Small
                           │
                           ▼
                    semantic candidates
                           │
                           ▼
                 cosine + recency
                           │
                           ▼
                     dedupe/note
                           │
                           ▼
                   context selection
                           │
                           ▼
             até 2000 caracteres reais
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
             MemoryPanel          Claude
```

---

## 31. Critério de sucesso principal

A implementação só está correta se:

> **Quando o retrieval semântico seleciona um chunk, o contexto enviado ao Claude contém o conteúdo relevante desse chunk, dentro do orçamento global de contexto, e o MemoryPanel mostra exatamente esse mesmo contexto.**

---

## 32. Critério de segurança contra regressão

Continuar funcionando quando:

```text
Vault conectado
Vault não conectado
índice vazio
índice antigo
modelo carregando
modelo indisponível
busca sem hits
busca falha
nota removida
nota modificada
nota muito grande
attachment presente
tool use
streaming
429
fallback recência
```

---

## 33. Ordem obrigatória de execução

### Etapa 1

Ler `CLAUDE.md` e todos os arquivos mencionados.

### Etapa 2

Mapear contratos entre:

```text
useVaultIndex
useVault
memoryContext
useChat
anthropic
api/chat
MemoryPanel
```

### Etapa 3

Criar/ajustar testes antes da alteração principal sempre que possível.

### Etapa 4

Implementar metadata estrutural nos chunks.

### Etapa 5

Implementar invalidation/versionamento do índice.

### Etapa 6

Atualizar embedding para usar contexto estrutural.

### Etapa 7

Atualizar retrieval para devolver metadata.

### Etapa 8

Corrigir `memoryContext` para preservar melhor o conteúdo recuperado.

### Etapa 9

Garantir que MemoryPanel e prompt usam exatamente a mesma fonte.

### Etapa 10

Adicionar observabilidade segura.

### Etapa 11

Executar testes.

### Etapa 12

Executar build.

### Etapa 13

Executar lint/design lint.

### Etapa 14

Revisar diff procurando regressões e alterações fora do escopo.

---

## 34. Regra de implementação importante

Não faça uma grande refatoração de uma vez.

Prefira pequenas alterações isoladas e testáveis.

Depois de cada bloco lógico:

```text
alterar
↓
testar
↓
verificar
↓
seguir
```

Não apagar código existente sem entender seus consumidores.

Não fazer cleanup fora do escopo.

---

## 35. Antes de finalizar

Apresente um resumo técnico contendo:

```text
1. arquivos modificados
2. arquivos novos
3. testes adicionados
4. como o chunk passou a ser representado
5. como o excerpt passou a ser selecionado
6. como o prompt passou a receber o contexto
7. como o MemoryPanel permanece sincronizado
8. versão do índice
9. resultado de npm test
10. resultado de npm run build
11. resultado de npm run lint:design
```

Também informe explicitamente:

```text
Modelo mantido:
Xenova/multilingual-e5-small Q8

Plano B/R2:
não implementado

Compatibilidade:
preservada

Fallback de recência:
preservado
```

---

## 36. Commit

Não faça commit automaticamente sem antes apresentar:

```bash
git diff
git status
```

e verificar que somente arquivos relacionados à Fase A.1 foram alterados.

Sugestão de commit:

```text
feat(memory): refine semantic retrieval context
```

---

## 37. Integração com a Metodologia Gabriel e os agents existentes

O repositório já possui uma arquitetura de agentes em:

```text
.claude/agents/
```

Não criar novos agents para esta tarefa.

Consulte primeiro:

```text
.claude/agents/README.md
CLAUDE.md
```

A metodologia de orquestração existente deve ser respeitada.

### Ordem de agentes recomendada para esta tarefa

#### 1. `scout_worker` — análise inicial, somente leitura

Antes de modificar qualquer arquivo, use o `scout_worker` para mapear:

```text
useVault.js
useVaultIndex.js
chunker.js
vectorIndex.js
embedder.js
embedder.worker.js
memoryContext.js
useChat.js
MemoryPanel.jsx
anthropic.js
api/chat.js
```

O objetivo é confirmar contratos, dependências e pontos de risco.

O `scout_worker` NÃO deve escrever código.

#### 2. Orchestrator — consolidação

O Orchestrator deve consolidar:

```text
análise do scout
+
CLAUDE.md
+
este plano
+
estado real da working tree
```

e produzir o plano concreto de implementação antes de delegar código.

#### 3. `ai_ml_worker` — implementação

A implementação de:

```text
chunker
vectorIndex
embedder
useVaultIndex
memoryContext
```

e qualquer integração relacionada a embeddings/ONNX deve ser delegada ao `ai_ml_worker`, seguindo o desenho definido pelo Orchestrator.

Esse agent atualmente está configurado no projeto como:

```text
model: sonnet
effort: low
```

Não tente alterar a configuração do agent durante esta tarefa apenas para aumentar effort.

#### 4. Reviewers

Despachar os reviewers somente quando os respectivos gatilhos forem realmente acionados:

```text
security-reviewer
architecture-guardian
performance-monitor
```

Não usar reviewers genéricos fora do escopo deles.

### Regra de não duplicação

O `.md` é a especificação específica desta tarefa.

Os agents fornecem:

```text
metodologia
papel
escopo
invariantes
```

Não duplique dentro deste plano todas as instruções gerais do `CLAUDE.md` ou de cada agent.

Quando houver conflito, seguir esta prioridade:

```text
CLAUDE.md
    ↓
arquitetura/agentes existentes
    ↓
este plano específico
    ↓
decisão do Orchestrator baseada no código real
```

Porém, se uma regra do `CLAUDE.md` parecer desatualizada em relação à Fase A já mergeada, não reverter comportamento existente silenciosamente. Verifique o código, o plano da Fase A e os commits recentes antes de decidir.

### Atenção especial ao agente `architecture-guardian`

O `architecture-guardian` contém uma verificação de privacidade que menciona que corpos de notas não devem sair do browser exceto pelo fluxo explícito de análise.

A Fase A já implementada alterou esse contrato de propósito: o retrieval semântico seleciona pequenos trechos de notas para compor `memoryContext` e esses trechos podem ser enviados ao Claude.

Portanto, nesta Fase A.1:

- não reintroduzir a arquitetura pré-Fase-A;
- não remover o retrieval semântico;
- não bloquear `memoryContext` selecionado;
- manter a regra de que **indexação/embeddings permanecem locais**;
- manter o limite de contexto e o princípio de enviar somente os trechos selecionados para o prompt.

Se o `architecture-guardian` sinalizar esse ponto por causa de uma regra histórica/desatualizada, o Orchestrator deve comparar o texto com o código atual e documentar a divergência em vez de desfazer a Fase A.

### Não alterar a configuração dos agents

Não editar nesta tarefa:

```text
.claude/agents/*.md
```

a menos que uma mudança específica de infraestrutura de agents seja descoberta como requisito real e seja apresentada separadamente ao usuário.

Esta Fase A.1 é sobre retrieval da memória, não sobre redesenhar o sistema de agentes.

## 38. Definição final da tarefa

Você não está construindo uma nova memória.

Você está refinando a memória semântica que já existe.

A prioridade é:

```text
PRECISÃO
>
RASTREABILIDADE
>
CONSISTÊNCIA
>
COMPATIBILIDADE
>
PERFORMANCE
```

e não:

```text
mais features
mais modelos
mais serviços
mais infraestrutura
```

O resultado deve parecer uma evolução natural da Fase A existente, sem quebrar o comportamento que já funciona.

## Comece agora

Primeiro leia os arquivos e faça uma análise do estado atual.

**Não altere código ainda.**

Apresente primeiro:

1. o fluxo atual confirmado;
2. os contratos entre os módulos;
3. os pontos exatos que serão modificados;
4. qualquer risco de regressão identificado;
5. a sequência de implementação que você pretende executar.

Depois disso, implemente a Fase A.1 seguindo este plano.

## 39. Modelo e nível de effort do Claude Code

A escolha do modelo e do nível de effort é uma configuração da sessão do Claude Code, não uma parte da arquitetura do repositório.

Para esta tarefa, o operador pode usar:

```text
Claude Opus 5
Effort: High
```

Para preservar o limite do plano Claude Pro.

Não adicionar lógica ao projeto para detectar ou controlar o modelo de conversa usado pelo Claude Code.

Os agents existentes têm seus próprios modelos/effort definidos nos respectivos frontmatters. Não alterá-los nesta tarefa.
