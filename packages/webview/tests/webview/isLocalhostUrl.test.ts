import { describe, it, expect } from 'vitest';
import { isLocalhostUrl } from '../../src/utils/isLocalhostUrl';

describe('isLocalhostUrl', () => {
    it('accepts localhost / 127.0.0.1 / [::1] with any port', () => {
        expect(isLocalhostUrl('http://localhost:5173/app')).toBe(true);
        expect(isLocalhostUrl('http://localhost')).toBe(true);
        expect(isLocalhostUrl('https://localhost:8443')).toBe(true);
        expect(isLocalhostUrl('http://127.0.0.1:3000/')).toBe(true);
        expect(isLocalhostUrl('http://[::1]:8080/page')).toBe(true);
    });

    it('rejects non-local hosts', () => {
        expect(isLocalhostUrl('https://example.com')).toBe(false);
        expect(isLocalhostUrl('http://192.168.1.10:5173')).toBe(false);
        expect(isLocalhostUrl('http://localhost.evil.com')).toBe(false);
        expect(isLocalhostUrl('http://127.0.0.2:80')).toBe(false);
    });

    it('rejects non-http(s) schemes and garbage', () => {
        expect(isLocalhostUrl('file:///etc/passwd')).toBe(false);
        expect(isLocalhostUrl('ftp://localhost/x')).toBe(false);
        expect(isLocalhostUrl('mailto:a@b.c')).toBe(false);
        expect(isLocalhostUrl('not a url')).toBe(false);
        expect(isLocalhostUrl('')).toBe(false);
    });
});
