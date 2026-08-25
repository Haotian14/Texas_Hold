import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 默认仍是 node。UI 测试在各自文件头用 `@vitest-environment jsdom`
    // 单独声明——理由见 src/ui/test-setup.ts。
    environment: 'node',
    setupFiles: ['./src/ui/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
