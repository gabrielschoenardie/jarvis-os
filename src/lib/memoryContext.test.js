import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryContext, buildMemoryDetail, buildRelevantExcerpt } from './memoryContext.js';

test('buildMemoryContext produz o mesmo formato de texto com ou sem score', () => {
  const withoutScore = buildMemoryContext([{ title: 'Nota A', content: 'corpo A' }]);
  const withScore = buildMemoryContext([{ title: 'Nota A', content: 'corpo A', score: 0.87 }]);
  assert.equal(withoutScore, withScore);
  assert.equal(withoutScore, 'Notas recentes do vault:\n— Nota A: corpo A');
});

test('buildMemoryDetail carrega o score quando presente e omite quando ausente', () => {
  const detail = buildMemoryDetail([
    { title: 'Com score', content: 'x', score: 0.42 },
    { title: 'Sem score', content: 'y' },
  ]);
  assert.equal(detail.notes[0].score, 0.42);
  assert.equal(detail.notes[1].score, undefined);
});

test('buildMemoryContext sem segundo argumento continua funcionando (default recency)', () => {
  const result = buildMemoryContext([{ title: 'Nota A', content: 'corpo A' }]);
  assert.equal(result, 'Notas recentes do vault:\n— Nota A: corpo A');
});

test('modo semantic usa o label de contexto relevante, não "recentes"', () => {
  const result = buildMemoryContext([{ title: 'Nota A', content: 'corpo A' }], { mode: 'semantic' });
  assert.match(result, /^Contexto relevante recuperado do vault:/);
  assert.doesNotMatch(result, /recentes/);
});

test('modo recência (default) preserva o label curto', () => {
  const result = buildMemoryContext([{ title: 'Nota A', content: 'corpo A' }], { mode: 'recency' });
  assert.match(result, /^Notas recentes do vault:/);
});

test('buildRelevantExcerpt devolve o chunk inteiro quando cabe no limite', () => {
  const text = 'Um texto curto que cabe inteiro.';
  const result = buildRelevantExcerpt(text, 400);
  assert.equal(result, text);
});

test('buildRelevantExcerpt para chunk >400 NÃO é apenas text.slice(0,400)', () => {
  const head = 'A'.repeat(300) + ' palavra final da cabeça relevante aqui mesmo. ';
  const tail = 'B'.repeat(300) + ' cauda relevante com informação essencial no final do texto.';
  const text = head + 'meio '.repeat(20) + tail;
  const result = buildRelevantExcerpt(text, 400);
  assert.notEqual(result, text.slice(0, 400));
  // deve conter conteúdo da cauda, que um slice(0,400) simples jamais incluiria
  assert.match(result, /cauda relevante/);
  assert.ok(result.length <= 400);
});

test('entry de 600 chars usa os 600 completos quando há orçamento (passada 2)', () => {
  const content600 = 'X'.repeat(600);
  const content300 = 'Y'.repeat(300);
  const entries = [
    { title: 'Grande', content: content600, score: 0.9 },
    { title: 'Pequena', content: content300, score: 0.5 },
  ];
  const detail = buildMemoryDetail(entries);
  assert.equal(detail.notes[0].excerpt, content600);
  assert.equal(detail.notes[1].excerpt, content300);
});

test('quatro entries de 900 chars: passada 2 expande a de maior score, total <= 2000', () => {
  const entries = [0, 1, 2, 3].map(i => ({
    title: `Nota ${i}`,
    content: String.fromCharCode(65 + i).repeat(900),
    score: 1 - i * 0.1,
  }));
  const detail = buildMemoryDetail(entries);
  assert.ok(detail.totalChars <= 2000);
  // a primeira (maior score) deve ter sido expandida além dos 400 da passada 1
  assert.ok(detail.notes[0].excerpt.length > 400);
});

test('múltiplas notas: totalChars sempre <= 2000', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    title: `Nota ${i}`,
    content: 'conteúdo relevante '.repeat(100),
    score: Math.random(),
  }));
  const detail = buildMemoryDetail(entries);
  assert.ok(detail.totalChars <= 2000);
});

test('truncamento não corta palavra ao meio (simpleTruncate, maxChars pequeno)', () => {
  const text = 'palavra1 palavra2 palavra3 palavra4 palavra5 palavra6 palavra7 palavra8';
  const result = buildRelevantExcerpt(text, 40);
  const withoutEllipsis = result.replace(/…$/, '');
  // cada "palavra" do resultado deve corresponder a um prefixo exato de uma
  // palavra completa do texto original (nunca um corte no meio de um token)
  const words = withoutEllipsis.trim().split(/\s+/).filter(Boolean);
  const originalWords = text.split(' ');
  for (const w of words) {
    assert.ok(originalWords.includes(w), `"${w}" não é uma palavra completa do original`);
  }
  assert.ok(result.length <= 40);
});

test('buildRelevantExcerpt nunca excede maxChars, varrendo tamanhos de 50 a 900', () => {
  const text = Array.from({ length: 30 }, (_, i) =>
    `Parágrafo número ${i} com bastante conteúdo textual para preencher espaço. ` +
    'Frase adicional para garantir volume suficiente de caracteres neste bloco de teste.'
  ).join('\n\n');
  for (let maxChars = 50; maxChars <= 900; maxChars += 10) {
    const result = buildRelevantExcerpt(text, maxChars);
    assert.ok(
      result.length <= maxChars,
      `maxChars=${maxChars} produziu result.length=${result.length}`
    );
  }
});

test('metadata (path, heading, headingPath, chunkIndex, chunkCount) repassada quando presente', () => {
  const entries = [{
    title: 'Nota com metadata',
    content: 'corpo',
    score: 0.5,
    path: 'pasta/nota.md',
    heading: 'Seção 2',
    headingPath: ['Título', 'Seção 2'],
    chunkIndex: 1,
    chunkCount: 3,
  }];
  const detail = buildMemoryDetail(entries);
  const note = detail.notes[0];
  assert.equal(note.path, 'pasta/nota.md');
  assert.equal(note.heading, 'Seção 2');
  assert.deepEqual(note.headingPath, ['Título', 'Seção 2']);
  assert.equal(note.chunkIndex, 1);
  assert.equal(note.chunkCount, 3);
});

test('metadata ausente não quebra e fica undefined (fallback de recência)', () => {
  const entries = [{ title: 'Nota sem metadata', content: 'corpo' }];
  const detail = buildMemoryDetail(entries);
  const note = detail.notes[0];
  assert.equal(note.path, undefined);
  assert.equal(note.heading, undefined);
  assert.equal(note.headingPath, undefined);
  assert.equal(note.chunkIndex, undefined);
  assert.equal(note.chunkCount, undefined);
  const context = buildMemoryContext(entries);
  assert.doesNotMatch(context, /undefined/);
});

test('simetria: cada detail.notes[i].excerpt aparece literalmente em buildMemoryContext', () => {
  const entries = [
    { title: 'Nota 1', content: 'X'.repeat(600), score: 0.9 },
    { title: 'Nota 2', content: 'Y'.repeat(900), score: 0.6 },
    { title: 'Nota 3', content: 'conteúdo curto', score: 0.3 },
  ];
  for (const mode of ['semantic', 'recency']) {
    const context = buildMemoryContext(entries, { mode });
    const detail = buildMemoryDetail(entries, { mode });
    for (const note of detail.notes) {
      assert.ok(
        context.includes(note.excerpt),
        `excerpt de "${note.title}" não aparece literalmente no contexto (mode=${mode})`
      );
    }
  }
});
