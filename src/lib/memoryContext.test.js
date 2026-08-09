import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryContext, buildMemoryDetail } from './memoryContext.js';

test('buildMemoryContext produz o mesmo formato de texto com ou sem score', () => {
  const withoutScore = buildMemoryContext([{ title: 'Nota A', content: 'corpo A' }]);
  const withScore = buildMemoryContext([{ title: 'Nota A', content: 'corpo A', score: 0.87 }]);
  assert.equal(withoutScore, withScore);
  assert.equal(withoutScore, 'Notas recentes do vault (mais recentes primeiro):\n— Nota A: corpo A');
});

test('buildMemoryDetail carrega o score quando presente e omite quando ausente', () => {
  const detail = buildMemoryDetail([
    { title: 'Com score', content: 'x', score: 0.42 },
    { title: 'Sem score', content: 'y' },
  ]);
  assert.equal(detail.notes[0].score, 0.42);
  assert.equal(detail.notes[1].score, undefined);
});
