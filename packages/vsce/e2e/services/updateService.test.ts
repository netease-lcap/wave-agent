import { test, expect } from '@playwright/test';

// Inline the pure functions under test (mirrors src/services/updateService.ts)
// This avoids browser/Node module resolution issues in Playwright tests.

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
}

function parseVersion(version: string): ParsedVersion | null {
    const core = version.replace(/^v?/, '').split('-')[0];
    const parts = core.split('.').map(Number);
    if (parts.length !== 3 || parts.some(p => Number.isNaN(p))) {
        return null;
    }
    return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    return 0;
}

test.describe('parseVersion', () => {
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

test.describe('compareVersions', () => {
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
