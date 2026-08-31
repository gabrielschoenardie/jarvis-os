import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptureFilename, buildCaptureMarkdown, captureSignature } from './chatCapture.js';

const turns = (...pairs) => pairs.map(([role, content]) => ({ role, content }));

test('o nome do arquivo deriva do início da conversa, não de agora', () => {
  const started = new Date(2026, 7, 31, 11, 36);
  assert.equal(buildCaptureFilename(started), 'Capture 2026-08-31 1136.md');
});

test('mesma conversa, mesma assinatura', () => {
  const t = turns(['operator', 'oi'], ['jarvis', 'às ordens']);
  const a = buildCaptureMarkdown({ startedAt: new Date(2026, 7, 31, 11, 36), turns: t });
  const b = buildCaptureMarkdown({ startedAt: new Date(2026, 7, 31, 11, 36), turns: t });
  assert.equal(captureSignature(a), captureSignature(b));
});

// O caso que gerava as duplicatas: recarregar o app restaura o histórico e
// carimba um `startedAt` novo. O corpo não mudou, então a assinatura não pode
// mudar — é ela que impede a gravação de um arquivo novo com o mesmo conteúdo.
test('startedAt diferente com o mesmo corpo não muda a assinatura', () => {
  const t = turns(['operator', 'oi'], ['jarvis', 'às ordens']);
  const manha = buildCaptureMarkdown({ startedAt: new Date(2026, 7, 31, 11, 36), turns: t });
  const tarde = buildCaptureMarkdown({ startedAt: new Date(2026, 7, 31, 15, 2), turns: t });
  assert.notEqual(manha, tarde); // o heading difere…
  assert.equal(captureSignature(manha), captureSignature(tarde)); // …mas o corpo não
});

test('um turno novo muda a assinatura', () => {
  const started = new Date(2026, 7, 31, 11, 36);
  const antes = buildCaptureMarkdown({ startedAt: started, turns: turns(['operator', 'oi']) });
  const depois = buildCaptureMarkdown({
    startedAt: started,
    turns: turns(['operator', 'oi'], ['jarvis', 'às ordens']),
  });
  assert.notEqual(captureSignature(antes), captureSignature(depois));
});

test('editar um turno existente muda a assinatura', () => {
  const started = new Date(2026, 7, 31, 11, 36);
  const a = buildCaptureMarkdown({ startedAt: started, turns: turns(['operator', 'oi']) });
  const b = buildCaptureMarkdown({ startedAt: started, turns: turns(['operator', 'olá']) });
  assert.notEqual(captureSignature(a), captureSignature(b));
});

// A continuação (nota triada + conversa que segue) grava só a fatia nova, então
// a assinatura tem de distinguir a fatia do histórico inteiro.
test('uma fatia do histórico tem assinatura diferente do histórico inteiro', () => {
  const started = new Date(2026, 7, 31, 11, 36);
  const todos = turns(['operator', 'um'], ['jarvis', 'dois'], ['operator', 'três']);
  const inteiro = buildCaptureMarkdown({ startedAt: started, turns: todos });
  const fatia = buildCaptureMarkdown({ startedAt: started, turns: todos.slice(2) });
  assert.notEqual(captureSignature(inteiro), captureSignature(fatia));
});

test('assinatura de conversa vazia é estável', () => {
  const started = new Date(2026, 7, 31, 11, 36);
  const a = buildCaptureMarkdown({ startedAt: started, turns: [] });
  const b = buildCaptureMarkdown({ startedAt: started, turns: [] });
  assert.equal(captureSignature(a), captureSignature(b));
});

test('markdown sem frontmatter não quebra a assinatura', () => {
  assert.equal(typeof captureSignature('só texto solto'), 'string');
  assert.notEqual(captureSignature('só texto solto'), captureSignature('outro texto'));
});
