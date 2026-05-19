#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const dest = join(publicDir, 'porcupine_params.pv');
const url = 'https://github.com/Picovoice/porcupine/raw/master/lib/common/porcupine_params.pv';

if (existsSync(dest)) {
  console.log('porcupine_params.pv já existe em public/ — pulando download.');
  process.exit(0);
}

console.log('Baixando porcupine_params.pv (~2MB)...');
mkdirSync(publicDir, { recursive: true });

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`Falha no download: HTTP ${res.status}`);
  process.exit(1);
}

const writer = createWriteStream(dest);
const reader = res.body.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  writer.write(Buffer.from(value));
}

writer.end();
await new Promise((resolve, reject) => {
  writer.on('finish', resolve);
  writer.on('error', reject);
});

console.log(`✓ porcupine_params.pv salvo em public/`);
