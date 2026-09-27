import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests d'éditeur ont besoin d'un DOM (ProseMirror).
    environment: 'jsdom',
  },
});
