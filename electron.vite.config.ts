import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { config as loadDotenv } from 'dotenv'

loadDotenv()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      'process.env.SUPABASE_URL':      JSON.stringify(process.env.SUPABASE_URL      ?? ''),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ''),
      'process.env.BOT_USERNAME':      JSON.stringify(process.env.BOT_USERNAME      ?? ''),
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload.ts') },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer') },
    },
    build: {
      rollupOptions: {
        input: {
          index:        resolve(__dirname, 'src/renderer/index.html'),
          auth:         resolve(__dirname, 'src/renderer/auth.html'),
          subscription: resolve(__dirname, 'src/renderer/subscription.html'),
        },
      },
    },
  },
})
