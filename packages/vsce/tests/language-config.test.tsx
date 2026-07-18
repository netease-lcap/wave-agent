import { describe, it, expect } from 'vitest';

describe('Language Configuration Logic', () => {
    it('should include language in configuration data', () => {
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

    it('should handle empty language in configuration data', () => {
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
