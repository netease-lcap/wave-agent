import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        reporter: 'dot',
        environment: 'jsdom',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        exclude: ['tests/services/**', 'node_modules'],
        setupFiles: ['tests/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['webview/src/**'],
            exclude: ['webview/src/index.tsx', 'webview/src/**/*.css'],
        },
    },
});
