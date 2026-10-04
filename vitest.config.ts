import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/sim must stay pure TypeScript, runnable in Node with no browser.
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
