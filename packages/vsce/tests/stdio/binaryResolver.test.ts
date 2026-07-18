import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    default: { execSync: mockExecSync, execFile: mockExecFile },
    execSync: mockExecSync,
    execFile: mockExecFile,
}));

vi.mock('fs', () => ({
    default: { existsSync: mockExistsSync },
    existsSync: mockExistsSync,
}));

// ── Import after mocks ─────────────────────────────────────────

import { resolveWaveBinary, _resetCacheForTesting, upgradeWaveBinary, resetCache, NPM_REGISTRY } from '../../src/stdio/binaryResolver';

describe('binaryResolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(false);
        _resetCacheForTesting();
    });

    afterEach(() => {
        _resetCacheForTesting();
    });

    // ── Found on PATH ──────────────────────────────────────────

    it('returns wave path from which/where command', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave') || cmd.includes('where wave')) {
                return '/usr/local/bin/wave\n';
            }
            throw new Error('unexpected');
        });

        const result = await resolveWaveBinary();
        expect(result).toBe('/usr/local/bin/wave');
    });

    it('trims whitespace and takes first line from which output', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) {
                return '  /usr/bin/wave\n/opt/wave\n';
            }
            throw new Error('unexpected');
        });

        const result = await resolveWaveBinary();
        expect(result).toBe('/usr/bin/wave');
    });

    // ── Found in npm global bin ────────────────────────────────

    it('finds wave in npm global bin directory when not on PATH', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) throw new Error('not found');
            if (cmd.includes('which npm')) return '/usr/bin/npm\n';
            if (cmd.includes('prefix -g')) return '/usr/local\n';
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExistsSync.mockImplementation((p: string) => {
            return p === '/usr/local/bin/wave';
        });

        const result = await resolveWaveBinary();
        expect(result).toBe('/usr/local/bin/wave');
    });

    // ── Installs wave-code when not found ──────────────────────

    it('installs wave-code globally when not found anywhere', async () => {
        let installCalled = false;
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) {
                if (installCalled) return '/usr/local/bin/wave\n';
                throw new Error('not found');
            }
            if (cmd.includes('which npm')) return '/usr/bin/npm\n';
            if (cmd.includes('prefix -g')) return '/usr/local\n';
            if (cmd.includes('install -g wave-code')) {
                installCalled = true;
                return '';
            }
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExistsSync.mockImplementation((p: string) => {
            return installCalled && p === '/usr/local/bin/wave';
        });

        const result = await resolveWaveBinary();
        expect(result).toBe('/usr/local/bin/wave');
        expect(installCalled).toBe(true);
    });

    // ── Caching ────────────────────────────────────────────────

    it('caches result and does not re-resolve on second call', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) return '/usr/local/bin/wave\n';
            throw new Error('unexpected');
        });

        const result1 = await resolveWaveBinary();
        const result2 = await resolveWaveBinary();

        expect(result1).toBe('/usr/local/bin/wave');
        expect(result2).toBe('/usr/local/bin/wave');
        // which wave should only be called once due to caching
        const whichCalls = mockExecSync.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes('which wave'),
        );
        expect(whichCalls).toHaveLength(1);
    });

    // ── Error cases ────────────────────────────────────────────

    it('throws when npm global prefix cannot be determined', () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) throw new Error('not found');
            if (cmd.includes('which npm')) throw new Error('not found');
            throw new Error(`unexpected: ${cmd}`);
        });
        // findNpm falls back to process.execPath dir checks; all return false
        mockExistsSync.mockReturnValue(false);

        expect(() => resolveWaveBinary()).toThrow(
            'Failed to determine npm global directory',
        );
    });

    it('throws when wave not found after installation', () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) throw new Error('not found');
            if (cmd.includes('which npm')) return '/usr/bin/npm\n';
            if (cmd.includes('prefix -g')) return '/usr/local\n';
            if (cmd.includes('install -g wave-code')) return '';
            throw new Error(`unexpected: ${cmd}`);
        });
        // wave never exists
        mockExistsSync.mockReturnValue(false);

        expect(() => resolveWaveBinary()).toThrow(
            'wave binary not found after installation',
        );
    });

    // ── install-if-missing registry ──────────────────────────────

    it('install-if-missing uses npmmirror registry', async () => {
        let installCmd = '';
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) {
                if (installCmd) return '/usr/local/bin/wave\n';
                throw new Error('not found');
            }
            if (cmd.includes('which npm')) return '/usr/bin/npm\n';
            if (cmd.includes('prefix -g')) return '/usr/local\n';
            if (cmd.includes('install -g wave-code')) {
                installCmd = cmd;
                return '';
            }
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExistsSync.mockImplementation((p: string) => !!installCmd && p === '/usr/local/bin/wave');

        const result = await resolveWaveBinary();
        expect(result).toBe('/usr/local/bin/wave');
        expect(installCmd).toContain(`--registry=${NPM_REGISTRY}`);
    });

    // ── resetCache ───────────────────────────────────────────────

    it('resetCache clears the cached path', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which wave')) return '/usr/local/bin/wave\n';
            throw new Error('unexpected');
        });

        await resolveWaveBinary();
        resetCache();
        await resolveWaveBinary();

        const whichCalls = mockExecSync.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes('which wave'),
        );
        expect(whichCalls).toHaveLength(2);
    });

    // ── upgradeWaveBinary ────────────────────────────────────────

    it('upgradeWaveBinary installs the target version via execFile with npmmirror registry', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which npm')) return '/usr/bin/npm\n';
            if (cmd.includes('which wave')) return '/usr/local/bin/wave\n';
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(null);
        });

        const result = await upgradeWaveBinary('1.2.3');

        expect(result).toBe('/usr/local/bin/wave');
        expect(mockExecFile).toHaveBeenCalledTimes(1);
        const callArgs = mockExecFile.mock.calls[0];
        expect(callArgs[0]).toBe('/usr/bin/npm');
        expect(callArgs[1]).toEqual([
            'install',
            '-g',
            'wave-code@1.2.3',
            `--registry=${NPM_REGISTRY}`,
        ]);
        // cache was invalidated: resolveWaveBinary re-ran `which wave`
        const whichCalls = mockExecSync.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes('which wave'),
        );
        expect(whichCalls).toHaveLength(1);
    });

    it('upgradeWaveBinary rejects when execFile errors', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes('which npm')) return '/usr/bin/npm\n';
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(new Error('install failed'));
        });

        await expect(upgradeWaveBinary('1.2.3')).rejects.toThrow('install failed');
    });
});
