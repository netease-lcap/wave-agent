import * as vscode from 'vscode';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

export interface UpdateInfo {
    latestVersion: string;
    currentVersion: string;
    downloadUrl: string;
    vsixUrl?: string;
    releaseNotes?: string;
}

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
}

/**
 * Parse a semver string (e.g., "0.3.1" or "0.3.1-alpha.0") into components.
 * Returns null if the version string is invalid.
 */
export function parseVersion(version: string): ParsedVersion | null {
    // Strip pre-release suffix for comparison
    const core = version.replace(/^v?/, '').split('-')[0];
    const parts = core.split('.').map(Number);
    if (parts.length !== 3 || parts.some(p => Number.isNaN(p))) {
        return null;
    }
    return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Compare two parsed versions. Returns:
 *  -1 if a < b
 *   0 if a === b
 *   1 if a > b
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    return 0;
}

/**
 * Check for updates by querying the GitHub Releases API.
 * Returns UpdateInfo if a newer version is available, or null otherwise.
 */
function httpGet(url: string, timeout = 10000): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Request timed out'));
        }, timeout);

        https.get(url, {
            headers: { 'User-Agent': 'Wave-VSCode-Extension' },
            timeout
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                clearTimeout(timer);
                resolve({ statusCode: res.statusCode || 0, body });
            });
        }).on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
    const current = parseVersion(currentVersion);
    if (!current) {
        console.warn('[UpdateService] Invalid current version:', currentVersion);
        return null;
    }

    try {
        const { statusCode, body } = await httpGet('https://api.github.com/repos/netease-lcap/wave-vsce/releases/latest');

        if (statusCode !== 200) {
            console.warn('[UpdateService] GitHub API returned non-OK status:', statusCode);
            return null;
        }

        const data = JSON.parse(body) as {
            tag_name: string;
            html_url: string;
            body?: string;
            assets?: Array<{ name: string; browser_download_url: string }>;
        };

        const latestTag = data.tag_name.replace(/^v/, '');
        const latest = parseVersion(latestTag);

        if (!latest) {
            console.warn('[UpdateService] Invalid latest version from GitHub:', data.tag_name);
            return null;
        }

        if (compareVersions(latest, current) > 0) {
            const vsixAsset = data.assets?.find(a => a.name.endsWith('.vsix'));
            return {
                latestVersion: latestTag,
                currentVersion: currentVersion,
                downloadUrl: data.html_url,
                vsixUrl: vsixAsset?.browser_download_url,
                releaseNotes: data.body
            };
        }

        return null;
    } catch (error) {
        console.warn('[UpdateService] Failed to check for updates:', error);
        return null;
    }
}

function httpDownload(url: string, destPath: string, timeout = 120000): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const timer = setTimeout(() => {
            file.destroy();
            reject(new Error('Download timed out'));
        }, timeout);

        https.get(url, {
            headers: { 'User-Agent': 'Wave-VSCode-Extension' },
            timeout
        }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirects
                httpDownload(res.headers.location, destPath, timeout).then(resolve).catch(reject);
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                clearTimeout(timer);
                file.close(() => resolve());
            });
        }).on('error', (err) => {
            clearTimeout(timer);
            file.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

/**
 * Download the .vsix file and install it.
 */
async function downloadAndInstall(vsixUrl: string): Promise<void> {
    const tmpDir = os.tmpdir();
    const fileName = path.basename(vsixUrl);
    const vsixPath = path.join(tmpDir, fileName);

    await httpDownload(vsixUrl, vsixPath);

    // Install the extension from local .vsix file
    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));

    // Clean up downloaded file
    try {
        fs.unlinkSync(vsixPath);
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Check for updates and show a native VS Code notification if a new version is available.
 * Uses globalState to cache: checks at most once per 24 hours, and dismisses ignored versions.
 * @param skipCooldown - When true (e.g. manual check), bypass the 24-hour cooldown.
 */
export async function checkAndNotify(context: vscode.ExtensionContext, skipCooldown = false): Promise<void> {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (!skipCooldown) {
        const lastCheckTime = context.globalState.get<number>('wave.lastUpdateCheck', 0);
        if (now - lastCheckTime < twentyFourHours) {
            return;
        }
    }

    // Record check time immediately to avoid duplicate checks
    await context.globalState.update('wave.lastUpdateCheck', now);

    const ignoredVersion = context.globalState.get<string>('wave.ignoredVersion');
    const updateInfo = await checkForUpdate(context.extension.packageJSON.version);

    if (!updateInfo) {
        if (skipCooldown) {
            vscode.window.showInformationMessage('当前已是最新版本');
        }
        return;
    }

    // Skip if user previously ignored this version
    if (updateInfo.latestVersion === ignoredVersion) {
        if (skipCooldown) {
            vscode.window.showInformationMessage(
                `当前已忽略 v${updateInfo.latestVersion}，最新版本为 v${updateInfo.latestVersion}`
            );
        }
        return;
    }

    const message = `Wave 代码智聊 新版本 v${updateInfo.latestVersion} 已可用 (当前 v${updateInfo.currentVersion})`;
    const buttons = updateInfo.vsixUrl ? ['自动更新', '查看更新', '忽略'] : ['查看更新', '忽略'];

    vscode.window.showInformationMessage(message, ...buttons).then(async selection => {
        if (selection === '自动更新' && updateInfo.vsixUrl) {
            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: '正在下载更新...' },
                    async () => downloadAndInstall(updateInfo.vsixUrl!)
                );
                vscode.window.showInformationMessage(
                    `Wave 代码智聊 已更新至 v${updateInfo.latestVersion}`,
                    '立即重启'
                ).then(choice => {
                    if (choice === '立即重启') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
            } catch (error) {
                console.error('[UpdateService] Auto-update failed:', error);
                vscode.window.showErrorMessage('自动更新失败，请手动下载更新');
            }
        } else if (selection === '查看更新') {
            vscode.env.openExternal(vscode.Uri.parse(updateInfo.downloadUrl));
        } else if (selection === '忽略') {
            context.globalState.update('wave.ignoredVersion', updateInfo.latestVersion);
        }
    });
}
