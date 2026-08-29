import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffIndex, packVectors, unpackVector, search, isIndexCompatible } from './vectorIndex.js';

test('diffIndex detecta nota nova', () => {
  const graph = { nodes: [{ path: 'a.md', title: 'A', mtime: 100 }] };
  const index = { notes: {} };
  const { toEmbed, toRemove } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, [{ path: 'a.md', title: 'A', mtime: 100 }]);
  assert.deepEqual(toRemove, []);
});

test('diffIndex detecta nota alterada (mtime mais novo)', () => {
  const graph = { nodes: [{ path: 'a.md', title: 'A', mtime: 200 }] };
  const index = { notes: { 'a.md': { mtime: 100 } } };
  const { toEmbed } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, [{ path: 'a.md', title: 'A', mtime: 200 }]);
});

test('diffIndex não re-embute nota sem mudança', () => {
  const graph = { nodes: [{ path: 'a.md', title: 'A', mtime: 100 }] };
  const index = { notes: { 'a.md': { mtime: 100 } } };
  const { toEmbed } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, []);
});

test('diffIndex ignora nós fantasma e sem path', () => {
  const graph = { nodes: [{ ghost: true, title: 'Ghost', mtime: 0 }] };
  const index = { notes: {} };
  const { toEmbed } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, []);
});

test('diffIndex detecta nota removida', () => {
  const graph = { nodes: [] };
  const index = { notes: { 'sumiu.md': { mtime: 50 } } };
  const { toRemove } = diffIndex(graph, index);
  assert.deepEqual(toRemove, ['sumiu.md']);
});

test('pack/unpack preserva os vetores originais', () => {
  const vectors = [Float32Array.from([1, 0, 0]), Float32Array.from([0, 1, 0])];
  const packed = packVectors(vectors, 3);
  assert.deepEqual([...unpackVector(packed, 0, 3)], [1, 0, 0]);
  assert.deepEqual([...unpackVector(packed, 1, 3)], [0, 1, 0]);
});

test('search devolve o vizinho correto num conjunto sintético de vetores', () => {
  const dims = 3;
  const vectors = packVectors([
    Float32Array.from([1, 0, 0]),
    Float32Array.from([0, 1, 0]),
    Float32Array.from([0.9, 0.1, 0]),
  ], dims);
  const index = {
    dims,
    vectors,
    chunks: [
      { path: 'x.md', text: 'x' },
      { path: 'y.md', text: 'y' },
      { path: 'x2.md', text: 'x2' },
    ],
  };
  const hits = search(index, Float32Array.from([1, 0, 0]), 2);
  assert.equal(hits[0].path, 'x.md');
  assert.equal(hits[1].path, 'x2.md');
});

test('search propaga title/heading/headingPath/chunkIndex quando presentes', () => {
  const dims = 3;
  const vectors = packVectors([Float32Array.from([1, 0, 0])], dims);
  const index = {
    dims,
    vectors,
    chunks: [
      {
        path: 'x.md',
        title: 'Nota X',
        heading: 'Seção 1',
        headingPath: 'Seção 1 > Sub',
        chunkIndex: 2,
        text: 'x',
      },
    ],
  };
  const hits = search(index, Float32Array.from([1, 0, 0]), 1);
  assert.equal(hits[0].title, 'Nota X');
  assert.equal(hits[0].heading, 'Seção 1');
  assert.equal(hits[0].headingPath, 'Seção 1 > Sub');
  assert.equal(hits[0].chunkIndex, 2);
});

test('search devolve undefined para metadata ausente (chunk no formato antigo)', () => {
  const dims = 3;
  const vectors = packVectors([Float32Array.from([1, 0, 0])], dims);
  const index = {
    dims,
    vectors,
    chunks: [{ path: 'x.md', text: 'x' }],
  };
  const hits = search(index, Float32Array.from([1, 0, 0]), 1);
  assert.equal(hits[0].title, undefined);
  assert.equal(hits[0].heading, undefined);
  assert.equal(hits[0].headingPath, undefined);
  assert.equal(hits[0].chunkIndex, undefined);
  assert.equal(hits[0].path, 'x.md');
  assert.equal(hits[0].text, 'x');
});

test('isIndexCompatible aceita índice com version/model/dims batendo', () => {
  const saved = { version: 2, model: 'multilingual-e5-small', dims: 384 };
  assert.equal(isIndexCompatible(saved, { version: 2, model: 'multilingual-e5-small', dims: 384 }), true);
});

test('isIndexCompatible rejeita version antiga (Teste 9 do plano de Fase A.1)', () => {
  const saved = { version: 1, model: 'multilingual-e5-small', dims: 384 };
  assert.equal(isIndexCompatible(saved, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('isIndexCompatible rejeita model diferente', () => {
  const saved = { version: 2, model: 'multilingual-e5-base', dims: 384 };
  assert.equal(isIndexCompatible(saved, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('isIndexCompatible rejeita dims diferente', () => {
  const saved = { version: 2, model: 'multilingual-e5-small', dims: 768 };
  assert.equal(isIndexCompatible(saved, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('isIndexCompatible rejeita saved null', () => {
  assert.equal(isIndexCompatible(null, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('isIndexCompatible rejeita saved undefined', () => {
  assert.equal(isIndexCompatible(undefined, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('isIndexCompatible rejeita objeto sem os campos esperados', () => {
  assert.equal(isIndexCompatible({}, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('isIndexCompatible rejeita version como string quando esperado é number (sem coerção frouxa)', () => {
  const saved = { version: '2', model: 'multilingual-e5-small', dims: 384 };
  assert.equal(isIndexCompatible(saved, { version: 2, model: 'multilingual-e5-small', dims: 384 }), false);
});

test('search mantém path/text/score corretos (não-regressão)', () => {
  const dims = 3;
  const vectors = packVectors([
    Float32Array.from([1, 0, 0]),
    Float32Array.from([0, 1, 0]),
  ], dims);
  const index = {
    dims,
    vectors,
    chunks: [
      { path: 'x.md', text: 'texto x' },
      { path: 'y.md', text: 'texto y' },
    ],
  };
  const hits = search(index, Float32Array.from([1, 0, 0]), 2);
  assert.equal(hits[0].path, 'x.md');
  assert.equal(hits[0].text, 'texto x');
  assert.equal(hits[0].score, 1);
  assert.equal(hits[1].path, 'y.md');
  assert.equal(hits[1].text, 'texto y');
  assert.equal(hits[1].score, 0);
});
