import { defineConfig } from 'vitest/config'

// Node environment on purpose: nothing in the extension API may need a DOM to be tested — the
// same source is meant to run in a worker one day. Tests live in `test/`, never in `src/`, so
// `src/` holds only the public surface.
export default defineConfig({
  test: {
    name: 'extension-api',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
