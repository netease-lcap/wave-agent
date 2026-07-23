import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ── Mocks ──────────────────────────────────────────────────────

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => vi.fn());
const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    default: { execSync: mockExecSync, execFile: mockExecFile, execFileSync: mockExecFileSync },
    execSync: mockExecSync,
    execFile: mockExecFile,
    execFileSync: mockExecFileSync,
}));

vi.mock('fs', () => ({
    default: { existsSync: mockExistsSync },
    existsSync: mockExistsSync,
}));

// ── Platform-aware constants ───────────────────────────────────
// The source uses `which`/`where`, `wave`/`wave.cmd`, and a different
// global-bin layout per platform. Mirror those here so mocks match on
// both Linux and Windows runners.

const isWin = process.platform === 'win32';
const waveLookup = isWin ? 'where wave' : 'which wave';
const npmLookup = isWin ? 'where npm' : 'which npm';
const npmBin = isWin ? 'C:\\nodejs\\npm.cmd' : '/usr/bin/npm';
const npmPrefix = isWin ? 'C:\\nodejs' : '/usr/local';
// Source: globalBin = prefix on Windows, path.join(prefix, 'bin') elsewhere.
const globalBin = isWin ? npmPrefix : path.join(npmPrefix, 'bin');
const waveName = isWin ? 'wave.cmd' : 'wave';
const globalWave = path.join(globalBin, waveName);

// ── Import after mocks ─────────────────────────────────────────

import { resolveWaveBinary, _resetCacheForTesting, upgradeWaveBinary, resetCache, getCliVersion, ensureCliUpToDate, NPM_REGISTRY } from '../../src/stdio/binaryResolver';

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
            if (cmd.includes(waveLookup)) {
                return `${globalWave}\n`;
            }
            throw new Error('unexpected');
        });

        const result = await resolveWaveBinary();
        expect(result).toBe(globalWave);
    });

    it('trims whitespace and takes first line from which output', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) {
                return `  /usr/bin/wave\n/opt/wave\n`;
            }
            throw new Error('unexpected');
        });

        const result = await resolveWaveBinary();
        expect(result).toBe('/usr/bin/wave');
    });

    // ── Found in npm global bin ────────────────────────────────

    it('finds wave in npm global bin directory when not on PATH', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) throw new Error('not found');
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            if (cmd.includes('prefix -g')) return `${npmPrefix}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExistsSync.mockImplementation((p: string) => {
            return p === globalWave;
        });

        const result = await resolveWaveBinary();
        expect(result).toBe(globalWave);
    });

    // ── Installs wave-code when not found ──────────────────────

    it('installs wave-code globally when not found anywhere', async () => {
        let installCalled = false;
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) {
                if (installCalled) return `${globalWave}\n`;
                throw new Error('not found');
            }
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            if (cmd.includes('prefix -g')) return `${npmPrefix}\n`;
            if (cmd.includes('install -g wave-code')) {
                installCalled = true;
                return '';
            }
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExistsSync.mockImplementation((p: string) => {
            return installCalled && p === globalWave;
        });

        const result = await resolveWaveBinary();
        expect(result).toBe(globalWave);
        expect(installCalled).toBe(true);
    });

    // ── Caching ────────────────────────────────────────────────

    it('caches result and does not re-resolve on second call', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            throw new Error('unexpected');
        });

        const result1 = await resolveWaveBinary();
        const result2 = await resolveWaveBinary();

        expect(result1).toBe(globalWave);
        expect(result2).toBe(globalWave);
        // wave lookup should only be called once due to caching
        const whichCalls = mockExecSync.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes(waveLookup),
        );
        expect(whichCalls).toHaveLength(1);
    });

    // ── Error cases ────────────────────────────────────────────

    it('throws when npm global prefix cannot be determined', () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) throw new Error('not found');
            if (cmd.includes(npmLookup)) throw new Error('not found');
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
            if (cmd.includes(waveLookup)) throw new Error('not found');
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            if (cmd.includes('prefix -g')) return `${npmPrefix}\n`;
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
            if (cmd.includes(waveLookup)) {
                if (installCmd) return `${globalWave}\n`;
                throw new Error('not found');
            }
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            if (cmd.includes('prefix -g')) return `${npmPrefix}\n`;
            if (cmd.includes('install -g wave-code')) {
                installCmd = cmd;
                return '';
            }
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExistsSync.mockImplementation((p: string) => !!installCmd && p === globalWave);

        const result = await resolveWaveBinary();
        expect(result).toBe(globalWave);
        expect(installCmd).toContain(`--registry=${NPM_REGISTRY}`);
    });

    // ── resetCache ───────────────────────────────────────────────

    it('resetCache clears the cached path', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            throw new Error('unexpected');
        });

        await resolveWaveBinary();
        resetCache();
        await resolveWaveBinary();

        const whichCalls = mockExecSync.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes(waveLookup),
        );
        expect(whichCalls).toHaveLength(2);
    });

    // ── upgradeWaveBinary ────────────────────────────────────────

    it('upgradeWaveBinary installs the target version via execFile with npmmirror registry', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(null);
        });

        const result = await upgradeWaveBinary('1.2.3');

        expect(result).toBe(globalWave);
        expect(mockExecFile).toHaveBeenCalledTimes(1);
        const callArgs = mockExecFile.mock.calls[0];
        expect(callArgs[0]).toBe(npmBin);
        expect(callArgs[1]).toEqual([
            'install',
            '-g',
            'wave-code@1.2.3',
            `--registry=${NPM_REGISTRY}`,
        ]);
        // cache was invalidated: resolveWaveBinary re-ran wave lookup
        const whichCalls = mockExecSync.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes(waveLookup),
        );
        expect(whichCalls).toHaveLength(1);
    });

    it('upgradeWaveBinary rejects when execFile errors', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(new Error('install failed'));
        });

        await expect(upgradeWaveBinary('1.2.3')).rejects.toThrow('install failed');
    });

    // ── Version validation (shell-injection guard) ────────────
    // On Windows, execFile runs through cmd.exe; the version is validated
    // first so shell metacharacters can never reach the shell.

    it('upgradeWaveBinary rejects non-semver versions and never reaches execFile', async () => {
        await expect(upgradeWaveBinary('1.2.3; rm -rf /')).rejects.toThrow('Invalid version');
        await expect(upgradeWaveBinary('$(rm -rf /)')).rejects.toThrow('Invalid version');
        await expect(upgradeWaveBinary('')).rejects.toThrow('Invalid version');
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('upgradeWaveBinary accepts prerelease/build semver', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(null);
        });

        await expect(upgradeWaveBinary('1.2.3-alpha.1')).resolves.toBe(globalWave);
        await expect(upgradeWaveBinary('1.2.3+build.7')).resolves.toBe(globalWave);
    });

    // ── Windows .cmd execFile guard ───────────────────────────
    // `npm` resolves to `npm.cmd` on Windows; execFile refuses a `.cmd`
    // without `shell: true` (ERR_CHILD_PROCESS_INVALID_COMMAND_FILE).
    // Simulate the guard on Linux so the reproducer runs in blocking CI.

    function withPlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
        const original = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: platform });
        return fn().finally(() => {
            if (original) Object.defineProperty(process, 'platform', original);
        });
    }

    it('upgradeWaveBinary uses shell:true for npm.cmd on Windows', async () => {
        const npmCmd = 'C:\\nodejs\\npm.cmd';
        const waveCmd = 'C:\\nodejs\\wave.cmd';

        await withPlatform('win32', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('where npm')) return `${npmCmd}\n`;
                if (cmd.includes('where wave')) return `${waveCmd}\n`;
                if (cmd.includes('prefix -g')) return 'C:\\nodejs\n';
                throw new Error(`unexpected: ${cmd}`);
            });
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const cmd = args[0] as string;
                const opts = args[2] as { shell?: boolean } | undefined;
                // Enforce Node's Windows guard: refuse npm.cmd without shell.
                if (/\.cmd$/i.test(cmd) && opts?.shell !== true) {
                    throw new Error('ERR_CHILD_PROCESS_INVALID_COMMAND_FILE');
                }
                const cb = args[args.length - 1] as (err: Error | null) => void;
                cb(null);
            });

            const result = await upgradeWaveBinary('1.2.3');

            expect(result).toBe(waveCmd);
            const callArgs = mockExecFile.mock.calls[0];
            expect(callArgs[0]).toBe(npmCmd);
            expect((callArgs[2] as { shell?: boolean }).shell).toBe(true);
        });
    });

    // ── getCliVersion ────────────────────────────────────────────

    it('getCliVersion returns the bare version from wave -v', () => {
        mockExecFileSync.mockReturnValue('0.18.7\n');
        expect(getCliVersion(globalWave)).toBe('0.18.7');
        expect(mockExecFileSync).toHaveBeenCalledTimes(1);
        const args = mockExecFileSync.mock.calls[0];
        expect(args[0]).toBe(globalWave);
        expect(args[1]).toEqual(['-v']);
    });

    it('getCliVersion strips a leading v prefix', () => {
        mockExecFileSync.mockReturnValue('v0.19.0\n');
        expect(getCliVersion(globalWave)).toBe('0.19.0');
    });

    it('getCliVersion returns null when wave -v throws', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
        expect(getCliVersion(globalWave)).toBeNull();
    });

    it('getCliVersion returns null for empty output', () => {
        mockExecFileSync.mockReturnValue('   \n  \n');
        expect(getCliVersion(globalWave)).toBeNull();
    });

    // ── ensureCliUpToDate ────────────────────────────────────────

    it('ensureCliUpToDate returns existing path when version is >= target', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFileSync.mockReturnValue('1.0.0\n');

        const result = await ensureCliUpToDate('1.0.0');
        expect(result).toBe(globalWave);
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('ensureCliUpToDate upgrades when version is older than target', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFileSync.mockReturnValue('0.18.0\n');
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(null);
        });

        const result = await ensureCliUpToDate('1.0.0');
        expect(result).toBe(globalWave);
        expect(mockExecFile).toHaveBeenCalledTimes(1);
        expect(mockExecFile.mock.calls[0][1]).toEqual([
            'install', '-g', 'wave-code@1.0.0', `--registry=${NPM_REGISTRY}`,
        ]);
    });

    it('ensureCliUpToDate upgrades when getCliVersion returns null (corrupt binary)', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            if (cmd.includes(npmLookup)) return `${npmBin}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        // corrupt binary: -v fails
        mockExecFileSync.mockImplementation(() => { throw new Error('corrupt'); });
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: Error | null) => void;
            cb(null);
        });

        const result = await ensureCliUpToDate('1.0.0');
        expect(result).toBe(globalWave);
        expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('ensureCliUpToDate does not upgrade when version is newer than target', async () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (cmd.includes(waveLookup)) return `${globalWave}\n`;
            throw new Error(`unexpected: ${cmd}`);
        });
        mockExecFileSync.mockReturnValue('2.0.0\n');

        const result = await ensureCliUpToDate('1.0.0');
        expect(result).toBe(globalWave);
        expect(mockExecFile).not.toHaveBeenCalled();
    });
});
