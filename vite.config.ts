import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径，使构建产物可以放在静态托管的任意子路径下
// （③-D 上线时不必回头改这里）。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
