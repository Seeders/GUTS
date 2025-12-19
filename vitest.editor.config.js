import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'global/**/tests/*.test.js'
    ],
    setupFiles: ['./tests/setup-editor.js']
  }
});
