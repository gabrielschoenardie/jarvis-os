import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, chunkNote } from './chunker.js';

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

test('chunkNote: nota sem heading -> heading/headingPath undefined, embeddingText com título sem "Seção:"', () => {
  const [c] = chunkNote('Conteúdo sem headings.', { path: 'a.md', title: 'Nota A' });
  assert.equal(c.heading, undefined);
  assert.equal(c.headingPath, undefined);
  assert.equal(c.embeddingText, 'Nota A\n\nConteúdo sem headings.');
});

test('chunkNote: hierarquia # -> ## -> ### produz headingPath com " > "', () => {
  const text = '# Fase A\n\n' + 'contexto inicial '.repeat(60) + '\n\n## A5. Retrieval\n\n' + 'texto da seção '.repeat(60) + '\n\n### Detalhe\n\n' + 'conteúdo profundo '.repeat(60);
  const chunks = chunkNote(text, { path: 'b.md', title: 'B' });
  const last = chunks[chunks.length - 1];
  assert.equal(last.heading, 'Detalhe');
  assert.equal(last.headingPath, 'Fase A > A5. Retrieval > Detalhe');
});

test('chunkNote: heading de mesmo nível substitui o anterior (não acumula irmãos)', () => {
  const text = '# Raiz\n\n## Primeiro\n\n' + 'conteúdo um '.repeat(80) + '\n\n## Segundo\n\n' + 'conteúdo dois '.repeat(80);
  const chunks = chunkNote(text, { path: 'c.md', title: 'C' });
  const last = chunks[chunks.length - 1];
  assert.equal(last.headingPath, 'Raiz > Segundo');
  assert.ok(!last.headingPath.includes('Primeiro'));
});

test('chunkNote: heading dentro de fence ``` não conta como heading', () => {
  const text = '# Título Real\n\ntexto normal\n\n```\n# não é heading\n```\n\nmais texto depois do fence';
  const chunks = chunkNote(text, { path: 'd.md', title: 'D' });
  for (const c of chunks) {
    assert.notEqual(c.heading, 'não é heading');
  }
  assert.equal(chunks[chunks.length - 1].heading, 'Título Real');
});

test('chunkNote: chunkIndex sequencial 0,1,2... numa nota longa', () => {
  const text = 'a'.repeat(2000);
  const chunks = chunkNote(text, { path: 'e.md', title: 'E' }, { size: 900, overlap: 150 });
  chunks.forEach((c, i) => assert.equal(c.chunkIndex, i));
  assert.equal(chunks.length, 3);
});

test('chunkNote: embeddingText nos três formatos exatos', () => {
  const text = '# H1\n\n## H2\n\nconteúdo da seção';
  const withPath = chunkNote(text, { path: 'f.md', title: 'Título F' });
  const last = withPath[withPath.length - 1];
  assert.equal(last.embeddingText, `Título F\nSeção: ${last.headingPath}\n\n${last.text}`);

  const noHeading = chunkNote('sem heading nenhum', { path: 'g.md', title: 'Título G' });
  assert.equal(noHeading[0].embeddingText, `Título G\n\n${noHeading[0].text}`);

  const noTitle = chunkNote('sem heading nenhum', { path: 'h.md' });
  assert.equal(noTitle[0].embeddingText, noTitle[0].text);
});

test('chunkNote: heading por cobertura dominante — chunk que herda overlap do heading anterior usa a seção majoritária', () => {
  // Reproduz o trace do bug: # Intro (offset 0) + ~800 chars, depois
  // ## Seção B + ~800 chars. O chunk 1 nasce do overlap (recua 150 chars a
  // partir da fronteira ~810) e cobre só ~150 chars de Intro contra ~750 de
  // Seção B — deve herdar Seção B, não Intro.
  const introBody = 'x'.repeat(800);
  const secaoBBody = 'y'.repeat(800);
  const text = `# Intro\n\n${introBody}\n\n## Seção B\n\n${secaoBBody}`;
  const chunks = chunkNote(text, { path: 'i.md', title: 'I' }, { size: 900, overlap: 150 });
  assert.ok(chunks.length >= 2, 'esperava pelo menos 2 chunks para reproduzir o overlap');
  const chunk1 = chunks[1];
  assert.equal(chunk1.heading, 'Seção B');
  assert.equal(chunk1.headingPath, 'Intro > Seção B');
});

test('chunkNote: chunk inteiramente antes do primeiro heading -> heading/headingPath undefined', () => {
  const text = 'z'.repeat(700) + '\n\n# Primeiro Heading\n\n' + 'w'.repeat(700);
  const chunks = chunkNote(text, { path: 'j.md', title: 'J' }, { size: 900, overlap: 150 });
  assert.equal(chunks[0].heading, undefined);
  assert.equal(chunks[0].headingPath, undefined);
});

test('chunkNote: chunk no miolo de uma seção longa (sem heading dentro dele) herda o heading da seção', () => {
  const text = '# Única Seção\n\n' + 'm'.repeat(3000);
  const chunks = chunkNote(text, { path: 'k.md', title: 'K' }, { size: 900, overlap: 150 });
  assert.ok(chunks.length >= 3);
  const middle = chunks[Math.floor(chunks.length / 2)];
  assert.equal(middle.heading, 'Única Seção');
});

test('chunkNote: empate de sobreposição resolve a favor do heading de menor offset', () => {
  // Segmento de A ("# A\n\n" + 100 chars) e segmento de B ("# B\n\n" + 102
  // chars) foram dimensionados para ter EXATAMENTE o mesmo tamanho (107
  // chars cada) quando medidos a partir do próprio heading até o próximo
  // (ou até o fim do texto). Um único chunk cobrindo o texto inteiro vê
  // sobreposição igual (107) com os dois segmentos — o menor offset (A)
  // deve vencer o empate.
  const text = '# A\n\n' + 'p'.repeat(100) + '\n\n# B\n\n' + 'q'.repeat(102);
  const chunks = chunkNote(text, { path: 'l.md', title: 'L' }, { size: 10000, overlap: 150 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, 'A');
});

test('chunkNote e chunkText produzem os mesmos textos (não-regressão)', () => {
  const texts = [
    '',
    'nota curta',
    '---\ndomain: video\n---\n\nConteúdo real.',
    'a'.repeat(2000),
    `${'a'.repeat(500)}\n\n${'b'.repeat(600)}`,
    '# Título\n\n## Seção A\n\nconteúdo A '.repeat(50) + '\n\n## Seção B\n\nconteúdo B '.repeat(50),
  ];
  for (const t of texts) {
    assert.deepEqual(chunkNote(t, {}).map(c => c.text), chunkText(t));
  }
});
