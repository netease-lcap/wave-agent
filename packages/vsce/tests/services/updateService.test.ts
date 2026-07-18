import { describe, test, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('fs', () => ({}));
vi.mock('http', () => ({}));
vi.mock('https', () => ({}));
vi.mock('os', () => ({}));
vi.mock('path', () => ({}));

import { parseVersion, compareVersions } from '../../src/services/updateService';

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
