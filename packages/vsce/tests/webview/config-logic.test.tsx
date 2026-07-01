import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Configuration Logic', () => {
    beforeEach(() => {
        delete process.env.WAVE_API_KEY;
        delete process.env.WAVE_BASE_URL;
        delete process.env.WAVE_CUSTOM_HEADERS;
        delete process.env.WAVE_SERVER_URL;
    });

    afterEach(() => {
        delete process.env.WAVE_API_KEY;
        delete process.env.WAVE_BASE_URL;
        delete process.env.WAVE_CUSTOM_HEADERS;
        delete process.env.WAVE_SERVER_URL;
    });

    it('should not show configuration if env vars are set', () => {
        process.env.WAVE_API_KEY = 'test-key';
        process.env.WAVE_BASE_URL = 'https://api.example.com';

        const config = {
            apiKey: '',
            headers: '',
            baseURL: '',
            serverUrl: ''
        };

        const isAuthValid = (!!config.apiKey || !!process.env.WAVE_API_KEY)
            || (!!config.headers || !!process.env.WAVE_CUSTOM_HEADERS)
            || (!!config.serverUrl || !!process.env.WAVE_SERVER_URL);

        const isBaseURLValid = !!config.baseURL || !!process.env.WAVE_BASE_URL || !!config.serverUrl || !!process.env.WAVE_SERVER_URL;

        expect(isAuthValid).toBe(true);
        expect(isBaseURLValid).toBe(true);
    });

    it('should show configuration if neither env vars nor config are set', () => {
        const config = {
            apiKey: '',
            headers: '',
            baseURL: '',
            serverUrl: ''
        };

        const isAuthValid = (!!config.apiKey || !!process.env.WAVE_API_KEY)
            || (!!config.headers || !!process.env.WAVE_CUSTOM_HEADERS)
            || (!!config.serverUrl || !!process.env.WAVE_SERVER_URL);

        const isBaseURLValid = !!config.baseURL || !!process.env.WAVE_BASE_URL || !!config.serverUrl || !!process.env.WAVE_SERVER_URL;

        expect(isAuthValid).toBe(false);
        expect(isBaseURLValid).toBe(false);
    });
});
