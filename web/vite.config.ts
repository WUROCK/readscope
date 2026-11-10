import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // 项目在仓库根目录执行 vite build，显式指定 web/ 为根目录。
  root: WEB_ROOT,
  // Electron 生产环境通过 file:// 加载 web/dist/index.html，必须使用相对路径。
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7411',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
