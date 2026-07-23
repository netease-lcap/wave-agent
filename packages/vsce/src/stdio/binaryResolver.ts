/**
 * BinaryResolver — locates or installs the `wave` CLI binary.
 *
 * 1. Check PATH for `wave`
 * 2. If missing, run `npm install -g wave-code`
 * 3. Resolve via npm global prefix
 *
 * Result is cached for the extension lifetime.
 */

import { execSync, execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseVersion, compareVersions } from '../services/updateService';

/** npm registry mirror for China users (faster than the default registry). */
export const NPM_REGISTRY = 'https://registry.npmmirror.com';

let cachedPath: string | undefined;

/**
 * Find `npm` CLI executable.
 * Checks PATH first, then falls back to the directory of the running Node binary.
 */
function findNpm(): string {
    const cmd = process.platform === 'win32' ? 'where npm' : 'which npm';
    try {
        const result = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        if (result) return result.split('\n')[0].trim();
    } catch {
        // not on PATH
    }

    // Fallback: look relative to process.execPath (the Node running VS Code)
    const nodeDir = path.dirname(process.execPath);
    const candidates = process.platform === 'win32'
        ? [path.join(nodeDir, 'npm.cmd'), path.join(nodeDir, 'npm')]
        : [path.join(nodeDir, 'npm'), path.join(nodeDir, '..', 'bin', 'npm')];

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }

    return 'npm';
}

/** Resolve the npm global bin directory. */
function getNpmGlobalBin(): string {
    const npm = findNpm();
    const prefix = execSync(`"${npm}" prefix -g`, {
        encoding: 'utf-8',
        stdio: 'pipe',
    }).trim();
    return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

/** Check if a file exists at the given path. */
function fileExists(p: string): boolean {
    try {
        return fs.existsSync(p);
    } catch {
        return false;
    }
}

export function resolveWaveBinary(): string {
    if (cachedPath) return cachedPath;

    // 1. Try PATH
    const whichCmd = process.platform === 'win32' ? 'where wave' : 'which wave';
    try {
        const result = execSync(whichCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        if (result) {
            cachedPath = result.split('\n')[0].trim();
            return cachedPath;
        }
    } catch {
        // not on PATH
    }

    // 2. Try npm global bin directory (might already be installed)
    let globalBin: string;
    try {
        globalBin = getNpmGlobalBin();
    } catch {
        throw new Error(
            'Failed to determine npm global directory. Please install wave-code manually: npm install -g wave-code --registry=https://registry.npmmirror.com',
        );
    }

    const waveName = process.platform === 'win32' ? 'wave.cmd' : 'wave';
    const globalPath = path.join(globalBin, waveName);
    if (fileExists(globalPath)) {
        cachedPath = globalPath;
        return cachedPath;
    }

    // 3. Install globally
    console.log('[Wave] wave binary not found, installing wave-code globally...');
    const npm = findNpm();
    execSync(`"${npm}" install -g wave-code --registry=${NPM_REGISTRY}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
    });

    // 4. Check npm global bin again
    if (fileExists(globalPath)) {
        cachedPath = globalPath;
        return cachedPath;
    }

    // 5. Try PATH again (install may have added it)
    try {
        const result = execSync(whichCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        if (result) {
            cachedPath = result.split('\n')[0].trim();
            return cachedPath;
        }
    } catch {
        // still not found
    }

    throw new Error(
        'wave binary not found after installation. Please install manually: npm install -g wave-code --registry=https://registry.npmmirror.com',
    );
}

/**
 * Run `<binaryPath> -v` and return the CLI's version (e.g. "0.18.7").
 * Returns null if the binary is missing, corrupt, or `-v` fails/times out —
 * callers treat null as "needs upgrade" rather than crashing.
 */
export function getCliVersion(binaryPath: string): string | null {
    try {
        const output = execFileSync(binaryPath, ['-v'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 5000,
            // `wave` is `wave.cmd` on Windows; Node refuses to execFileSync a
            // `.cmd` without a shell.
            shell: process.platform === 'win32',
        });
        const line = output.trim().split('\n')[0]?.trim();
        if (!line) return null;
        // `wave -v` prints the bare version; tolerate a leading "v" just in case.
        return line.replace(/^v/, '');
    } catch {
        return null;
    }
}

/**
 * Ensure the `wave` CLI exists and its version is >= targetVersion.
 * Returns the (possibly upgraded) binary path.
 *
 * 1. resolveWaveBinary() — auto-installs via npm if missing.
 * 2. getCliVersion(path) — read the installed CLI version via `wave -v`.
 * 3. If null (binary corrupt/unreadable) or older than target → upgrade to
 *    targetVersion (which resets the cache and re-resolves).
 */
export async function ensureCliUpToDate(targetVersion: string): Promise<string> {
    const binaryPath = resolveWaveBinary();
    const current = getCliVersion(binaryPath);
    if (current !== null) {
        const cur = parseVersion(current);
        const target = parseVersion(targetVersion);
        if (cur && target && compareVersions(cur, target) >= 0) {
            return binaryPath;
        }
    }
    // current is null (corrupt) or older than target → upgrade.
    return upgradeWaveBinary(targetVersion);
}

/** Reset cached binary path. Public so callers can force re-resolve after an upgrade. */
export function resetCache(): void {
    cachedPath = undefined;
}

/**
 * Upgrade the globally-installed `wave-code` CLI to a specific version.
 * Uses `execFile` (not a shell string) to avoid shell injection of the version arg.
 * Resets the cached path on success and returns the freshly-resolved binary path.
 */
export async function upgradeWaveBinary(targetVersion: string): Promise<string> {
    // Validate the version before it touches a shell. targetVersion originates
    // from the extension's package.json (trusted), but on Windows execFile runs
    // through cmd.exe (see shell option below); a strict semver check preserves
    // the "no shell injection of the version arg" guarantee this function held
    // when it used execFile without a shell.
    const SEMVER_RE = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
    if (!SEMVER_RE.test(targetVersion)) {
        throw new Error(`Invalid version: ${targetVersion}`);
    }

    const npm = findNpm();
    await new Promise<void>((resolve, reject) => {
        execFile(
            npm,
            ['install', '-g', `wave-code@${targetVersion}`, `--registry=${NPM_REGISTRY}`],
            // `npm` is `npm.cmd` on Windows; Node refuses to execFile a `.cmd`
            // without a shell (ERR_CHILD_PROCESS_INVALID_COMMAND_FILE). The
            // validated version above contains no shell metacharacters.
            { encoding: 'utf-8', shell: process.platform === 'win32' },
            (err) => {
                if (err) reject(err);
                else resolve();
            },
        );
    });
    cachedPath = undefined; // invalidate cache so resolveWaveBinary picks up the new binary
    return resolveWaveBinary();
}

/** Reset cached path — for testing only. */
export function _resetCacheForTesting(): void {
    cachedPath = undefined;
}
