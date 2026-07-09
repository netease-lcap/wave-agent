import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, 'tests/__mocks__/vscode.ts'),
        },
    },
    test: {
        globals: true,
        reporter: 'dot',
        environment: 'jsdom',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        exclude: ['tests/services/**', 'node_modules'],
        setupFiles: ['tests/setup.ts'],
        server: {
            deps: {
                inline: ['wave-agent-sdk'],
            },
        },
        coverage: {
            provider: 'v8',
            include: ['webview/src/**'],
            exclude: ['webview/src/index.tsx', 'webview/src/**/*.css'],
        },
    },
});
