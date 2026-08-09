import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from './chunker.js';

test('texto vazio retorna lista vazia', () => {
  assert.deepEqual(chunkText(''), []);
});

test('texto menor que o tamanho do chunk vira um único chunk', () => {
  assert.deepEqual(chunkText('nota curta sobre VBV'), ['nota curta sobre VBV']);
});

test('remove frontmatter antes de cortar', () => {
  const raw = '---\ndomain: video\nstatus: seed\n---\n\nConteúdo real da nota.';
  assert.deepEqual(chunkText(raw), ['Conteúdo real da nota.']);
});

test('texto longo sem parágrafos corta em blocos com overlap fixo', () => {
  const text = 'a'.repeat(2000);
  const chunks = chunkText(text, { size: 900, overlap: 150 });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 900);
  assert.equal(chunks[0].slice(-150), chunks[1].slice(0, 150));
});

test('prefere cortar em fronteira de parágrafo na metade final da janela', () => {
  const partA = 'a'.repeat(500);
  const partB = 'b'.repeat(600);
  const text = `${partA}\n\n${partB}`; // parágrafo cai dentro da janela [450,900)
  const chunks = chunkText(text, { size: 900, overlap: 150 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], 'a'.repeat(500));
  assert.ok(chunks[1].startsWith('a'.repeat(148)));
  assert.ok(chunks[1].endsWith('b'.repeat(600)));
});
