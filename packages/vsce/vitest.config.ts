import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        reporter: 'dot',
        include: ['tests/**/*.test.ts'],
    },
});
