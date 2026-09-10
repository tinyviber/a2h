import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // `examples/` are demo workspaces, not part of this package's suite. Their
    // test files exist to show what an agent-produced workspace looks like.
    exclude: ['node_modules/**', 'dist/**', 'examples/**'],
  },
});
