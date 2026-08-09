import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffIndex, packVectors, unpackVector, search } from './vectorIndex.js';

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
