/**
 * BinaryResolver — locates or installs the `wave` CLI binary.
 *
 * 1. Check PATH for `wave`
 * 2. If missing, run `npm install -g wave-code`
 * 3. Resolve via npm global prefix
 *
 * Result is cached for the extension lifetime.
 */

import { execSync, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
    const npm = findNpm();
    await new Promise<void>((resolve, reject) => {
        execFile(
            npm,
            ['install', '-g', `wave-code@${targetVersion}`, `--registry=${NPM_REGISTRY}`],
            { encoding: 'utf-8' },
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
