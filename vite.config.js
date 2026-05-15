import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      // Permite microfone em localhost
      'Permissions-Policy': 'microphone=(self)',
    },
  },
})
