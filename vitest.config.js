import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'projects/**/tests/*.test.js',
      'global/**/tests/*.test.js'
    ],
    setupFiles: ['./tests/setup.js']
  }
});
