#!/usr/bin/env node
// Baixa os arquivos do modelo de embeddings (quantizado q8) do Hugging Face
// Hub para public/models/, rodado no postinstall — assim o build da Vercel
// também busca o modelo antes de `vite build`. public/models/ está no
// .gitignore: ~35 MB não entra no repo. Falha aqui NUNCA quebra o
// install/build — sem modelo, useVaultIndex cai no fallback de recência
// (docs/HYBRID_MEMORY_PLAN.md, A7).

import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const DEST_DIR = path.join('public', 'models', MODEL_ID);

const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function fetchFile(relPath) {
  const dest = path.join(DEST_DIR, relPath);
  if (await exists(dest)) { console.log(`[fetch-embedding-model] já existe: ${relPath}`); return; }
  await mkdir(path.dirname(dest), { recursive: true });
  const url = `${BASE_URL}/${relPath}`;
  console.log(`[fetch-embedding-model] baixando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`falha ao baixar ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function main() {
  for (const f of FILES) {
    await fetchFile(f);
  }
  console.log('[fetch-embedding-model] modelo pronto em', DEST_DIR);
}

main().catch(err => {
  console.error('[fetch-embedding-model] erro:', err.message);
  process.exitCode = 0;
});
