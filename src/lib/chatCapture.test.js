import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaptureFilename, buildCaptureMarkdown, captureSignature, resolveCaptureSlice,
} from './chatCapture.js';

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

// A regressão relatada: recarregar sem dizer nada fazia nascer um arquivo. A
// conversa restaurada é adotada com base = tamanho do histórico, e daí em
// diante nada é gravado até chegar um turno novo.
test('conversa restaurada e adotada não grava nada', () => {
  assert.deepEqual(resolveCaptureSlice(6, 6), { base: 6, skip: true });
});

test('um turno novo depois da adoção grava só o turno novo', () => {
  assert.deepEqual(resolveCaptureSlice(6, 7), { base: 6, skip: false });
});

test('conversa nova (base zero) grava tudo', () => {
  assert.deepEqual(resolveCaptureSlice(0, 3), { base: 0, skip: false });
});

test('histórico vazio não grava', () => {
  assert.deepEqual(resolveCaptureSlice(0, 0), { base: 0, skip: true });
});

// O corte de 60 turnos do localStorage pode deixar o índice para trás; nesse
// caso é melhor repetir turnos do que parar de capturar em silêncio.
test('índice obsoleto pelo corte do histórico volta a zero', () => {
  assert.deepEqual(resolveCaptureSlice(80, 60), { base: 0, skip: false });
});

test('markdown sem frontmatter não quebra a assinatura', () => {
  assert.equal(typeof captureSignature('só texto solto'), 'string');
  assert.notEqual(captureSignature('só texto solto'), captureSignature('outro texto'));
});
