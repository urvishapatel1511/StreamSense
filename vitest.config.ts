import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['frontend/src/**/*.test.tsx', 'backend/src/**/*.test.ts'],
    restoreMocks: true,
    maxWorkers: 2,
  },
});
