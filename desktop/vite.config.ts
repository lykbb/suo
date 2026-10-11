import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import { drawingAssets } from './scripts/drawing-fonts.mjs';
import react from '@vitejs/plugin-react';
import { pdfAssets } from './scripts/pdf-assets.mjs';
import { devApi } from './bridge/dev-api.mjs';

export default defineConfig({
  plugins: [react(), pdfAssets(), drawingAssets(), devApi()],
  cacheDir: 'data/vite-cache',
  clearScreen: false,
  server: { fs: { allow: ['.', realpathSync(new URL('./node_modules', import.meta.url))],
    deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/state/agent/**', '**/data/connections/**', '**/data/agent/**', '**/data/imports/**', '**/data/workspaces/**', '**/data/adoption/**', '**/data/real-model-probe/**', '**/backups/**', '**/releases/**', '**/build-resources/**'] }, host: '127.0.0.1', port: 1420, strictPort: true,
    watch: { ignored: ['**/src-tauri/target/**', '**/dist/**', '**/.cargo-cache/**', '**/.npm-cache/**', '**/build-resources/**', '**/data/**', '**/preview/**', '**/backups/**', '**/releases/**'] } },
  envPrefix: ['VITE_'],
  build: { target: 'safari15', sourcemap: false, rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], flow: ['@xyflow/react'], motion: ['motion/react'] } } } },
});
