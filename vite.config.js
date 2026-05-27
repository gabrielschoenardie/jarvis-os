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
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ['@ricky0123/vad-react', '@ricky0123/vad-web', 'onnxruntime-web'],
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
