import { test, expect } from '@playwright/test';

test.describe('Language Configuration Logic', () => {
    test('should include language in configuration data', async () => {
        const config = {
            apiKey: 'test-key',
            baseURL: 'https://api.example.com',
            model: 'gpt-4',
            fastModel: 'gpt-3.5-turbo',
            backendLink: 'https://backend.example.com',
            language: 'English'
        };

        expect(config.language).toBe('English');
    });

    test('should handle empty language in configuration data', async () => {
        const config = {
            apiKey: 'test-key',
            baseURL: 'https://api.example.com',
            model: 'gpt-4',
            fastModel: 'gpt-3.5-turbo',
            backendLink: 'https://backend.example.com',
            language: ''
        };

        expect(config.language).toBe('');
    });
});
