import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ricky0123/vad-react', '@ricky0123/vad-web', 'onnxruntime-web'],
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
