import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dest: '.' },
        { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx', dest: '.' },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', dest: '.' },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', dest: '.' },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', dest: '.' },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs', dest: '.' },
        // @huggingface/transformers embute sua própria cópia (nightly pinned) do
        // onnxruntime-web em node_modules/@huggingface/transformers/node_modules/,
        // com os MESMOS nomes de arquivo mas versão diferente da raiz (usada pelo
        // VAD). Copiadas pra uma pasta separada para não colidir com os arquivos
        // do VAD em "/" — ver comentário em src/workers/embedder.worker.js.
        { src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', dest: 'embedder-wasm' },
        { src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', dest: 'embedder-wasm' },
        { src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', dest: 'embedder-wasm' },
        { src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs', dest: 'embedder-wasm' },
      ],
    }),
  ],
  optimizeDeps: {
    include: ['three', 'd3-force-3d'],
    exclude: ['@ricky0123/vad-react', '@ricky0123/vad-web', 'onnxruntime-web', '@huggingface/transformers'],
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    headers: {
      'Permissions-Policy': 'microphone=(self)',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
