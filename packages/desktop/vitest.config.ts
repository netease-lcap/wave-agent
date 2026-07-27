import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'tests/__mocks__/electron.ts'),
    },
  },
  test: {
    globals: true,
    reporter: 'dot',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules'],
    server: {
      deps: {
        inline: ['wave-agent-sdk'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
});
