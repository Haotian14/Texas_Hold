import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 与 vite.config.ts 同一份别名。两处都要写：测试不经过 vite.config.ts，
  // 少写一处的症状是「应用跑得起来但测试报模块找不到」。
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // 默认仍是 node。UI 测试在各自文件头用 `@vitest-environment jsdom`
    // 单独声明——理由见 src/ui/test-setup.ts。
    environment: 'node',
    setupFiles: ['./src/ui/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
