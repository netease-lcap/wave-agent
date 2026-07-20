import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('vscode', () => ({}));
vi.mock('fs', () => ({}));
vi.mock('os', () => ({}));
vi.mock('path', () => ({}));

const httpGetCalls: Array<{ proto: 'http' | 'https'; url: string }> = [];
function createMockGetter(proto: 'http' | 'https') {
    return vi.fn((url: string, _options: unknown, callback: (res: { statusCode: number; on: typeof EventEmitter.prototype.on; emit: typeof EventEmitter.prototype.emit }) => void) => {
        httpGetCalls.push({ proto, url });
        const ee = new EventEmitter();
        const res = { statusCode: 0, on: ee.on.bind(ee), emit: ee.emit.bind(ee) };
        // Defer so the callback can attach listeners before events fire.
        process.nextTick(() => {
            if (url.includes('/api/downloads/manifest.json')) {
                const fixture = manifestFixture;
                if (fixture === null) {
                    res.statusCode = 500;
                    callback(res);
                    res.emit('end');
                    return;
                }
                res.statusCode = fixture.statusCode;
                callback(res);
                res.emit('data', fixture.body);
                res.emit('end');
                return;
            } else if (url.includes('api.github.com')) {
                const fixture = githubFixture;
                if (fixture === null) {
                    throw new Error('GitHub fixture not configured for this test');
                }
                res.statusCode = fixture.statusCode;
                callback(res);
                res.emit('data', fixture.body);
                res.emit('end');
                return;
            }
            res.statusCode = 404;
            callback(res);
            res.emit('end');
        });
        // Return an emitter so .on('error', ...) can be chained by the caller.
        const req = new EventEmitter();
        return req;
    });
}

let manifestFixture: { statusCode: number; body: string } | null = null;
let githubFixture: { statusCode: number; body: string } | null = null;

vi.mock('http', () => ({ get: createMockGetter('http') }));
vi.mock('https', () => ({ get: createMockGetter('https') }));

import { parseVersion, compareVersions, checkForUpdate } from '../../src/services/updateService';

const GITHUB_RELEASE_BODY = JSON.stringify({
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/netease-lcap/wave-agent/releases/tag/v1.2.0',
    body: 'release notes',
    assets: [
        { name: 'wave-vscode-1.2.0.vsix', browser_download_url: 'https://github.com/netease-lcap/wave-agent/releases/download/v1.2.0/wave-vscode-1.2.0.vsix' }
    ]
});

beforeEach(() => {
    httpGetCalls.length = 0;
    manifestFixture = null;
    githubFixture = null;
});

describe('parseVersion', () => {
    test('parses standard semver', () => {
        expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    test('parses version with v prefix', () => {
        expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    test('parses version with pre-release suffix', () => {
        expect(parseVersion('0.3.1-alpha.0')).toEqual({ major: 0, minor: 3, patch: 1 });
    });

    test('parses zero version', () => {
        expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    });

    test('returns null for invalid versions', () => {
        expect(parseVersion('invalid')).toBeNull();
        expect(parseVersion('1.2')).toBeNull();
        expect(parseVersion('1.2.3.4')).toBeNull();
        expect(parseVersion('')).toBeNull();
    });
});

describe('compareVersions', () => {
    test('returns 0 for equal versions', () => {
        const v = { major: 1, minor: 2, patch: 3 };
        expect(compareVersions(v, v)).toBe(0);
    });

    test('compares major version', () => {
        expect(compareVersions(
            { major: 2, minor: 0, patch: 0 },
            { major: 1, minor: 9, patch: 9 }
        )).toBe(1);
        expect(compareVersions(
            { major: 1, minor: 0, patch: 0 },
            { major: 2, minor: 0, patch: 0 }
        )).toBe(-1);
    });

    test('compares minor version', () => {
        expect(compareVersions(
            { major: 1, minor: 3, patch: 0 },
            { major: 1, minor: 2, patch: 9 }
        )).toBe(1);
    });

    test('compares patch version', () => {
        expect(compareVersions(
            { major: 1, minor: 2, patch: 4 },
            { major: 1, minor: 2, patch: 3 }
        )).toBe(1);
    });
});

describe('checkForUpdate', () => {
    test('CodeChat manifest 200 + vscode present + newer version returns UpdateInfo with absolute vsixUrl', async () => {
        manifestFixture = {
            statusCode: 200,
            body: JSON.stringify({
                version: '1.2.0',
                downloads: { vscode: '/api/downloads/codechat-vscode.vsix' }
            })
        };

        const result = await checkForUpdate('1.1.0', 'http://example.test');

        expect(result).not.toBeNull();
        expect(result!.latestVersion).toBe('1.2.0');
        expect(result!.currentVersion).toBe('1.1.0');
        expect(result!.vsixUrl).toBe('http://example.test/api/downloads/codechat-vscode.vsix');
        // GitHub NOT hit
        expect(httpGetCalls.some(c => c.url.includes('api.github.com'))).toBe(false);
    });

    test('CodeChat manifest 200 + vscode absent returns null and does not fall back to GitHub', async () => {
        manifestFixture = {
            statusCode: 200,
            body: JSON.stringify({
                version: '1.2.0',
                downloads: {}
            })
        };

        const result = await checkForUpdate('1.1.0', 'http://example.test');

        expect(result).toBeNull();
        expect(httpGetCalls.some(c => c.url.includes('api.github.com'))).toBe(false);
    });

    test('CodeChat manifest non-200 falls back to GitHub and returns GitHub UpdateInfo', async () => {
        manifestFixture = null; // manifest endpoint returns 500
        githubFixture = { statusCode: 200, body: GITHUB_RELEASE_BODY };

        const result = await checkForUpdate('1.1.0', 'http://example.test');

        expect(result).not.toBeNull();
        expect(result!.latestVersion).toBe('1.2.0');
        expect(httpGetCalls.some(c => c.url.includes('api.github.com'))).toBe(true);
    });

    test('serverUrl empty/undefined uses GitHub path with netease-lcap/wave-agent repo', async () => {
        githubFixture = { statusCode: 200, body: GITHUB_RELEASE_BODY };

        const result = await checkForUpdate('1.1.0');

        expect(result).not.toBeNull();
        expect(result!.latestVersion).toBe('1.2.0');
        const githubCall = httpGetCalls.find(c => c.url.includes('api.github.com'));
        expect(githubCall).toBeDefined();
        expect(githubCall!.url).toContain('netease-lcap/wave-agent');
        expect(githubCall!.url).not.toContain('netease-lcap/wave-vsce');
    });

    test('CodeChat manifest 200 + version not newer returns null', async () => {
        manifestFixture = {
            statusCode: 200,
            body: JSON.stringify({
                version: '1.1.0',
                downloads: { vscode: '/api/downloads/codechat-vscode.vsix' }
            })
        };

        const result = await checkForUpdate('1.1.0', 'http://example.test');

        expect(result).toBeNull();
        expect(httpGetCalls.some(c => c.url.includes('api.github.com'))).toBe(false);
    });
});
