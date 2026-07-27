/**
 * Update checker for the desktop app — queries GitHub Releases (or the
 * CodeChat downloads manifest when a serverUrl is configured).
 * Ported from packages/vsce/src/services/updateService.ts without the
 * VS Code-specific notification/install code.
 */

import * as http from 'http';
import * as https from 'https';
import { parseVersion, compareVersions, type ParsedVersion } from './version';

export interface UpdateInfo {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  releaseNotes?: string;
}

function httpGet(url: string, timeout = 10000): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, timeout);

    const getter = url.startsWith('https:') ? https.get : http.get;
    getter(url, {
      headers: { 'User-Agent': 'Wave-Desktop' },
      timeout,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
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

async function checkViaGitHub(currentVersion: string, current: ParsedVersion): Promise<UpdateInfo | null> {
  const { statusCode, body } = await httpGet('https://api.github.com/repos/netease-lcap/wave-agent/releases/latest');

  if (statusCode !== 200) {
    console.warn('[UpdateChecker] GitHub API returned non-OK status:', statusCode);
    return null;
  }

  const data = JSON.parse(body) as {
    tag_name: string;
    html_url: string;
    body?: string;
  };

  const latestTag = data.tag_name.replace(/^v/, '');
  const latest = parseVersion(latestTag);

  if (!latest) {
    console.warn('[UpdateChecker] Invalid latest version from GitHub:', data.tag_name);
    return null;
  }

  if (compareVersions(latest, current) > 0) {
    return {
      latestVersion: latestTag,
      currentVersion,
      downloadUrl: data.html_url,
      releaseNotes: data.body,
    };
  }

  return null;
}

async function checkViaCodeChat(currentVersion: string, current: ParsedVersion, serverUrl: string): Promise<UpdateInfo | null> {
  const { statusCode, body } = await httpGet(`${serverUrl}/api/downloads/manifest.json`, 5000);

  if (statusCode !== 200) {
    throw new Error(`CodeChat manifest returned non-OK status: ${statusCode}`);
  }

  const data = JSON.parse(body) as { version: string };
  const latest = parseVersion(data.version);

  if (!latest) {
    console.warn('[UpdateChecker] Invalid latest version from CodeChat:', data.version);
    return null;
  }

  if (compareVersions(latest, current) <= 0) {
    return null;
  }

  return {
    latestVersion: data.version,
    currentVersion,
    downloadUrl: `${serverUrl}/api/downloads/manifest.json`,
    releaseNotes: undefined,
  };
}

/** Returns UpdateInfo when a newer desktop version exists, null otherwise. */
export async function checkForUpdate(currentVersion: string, serverUrl?: string): Promise<UpdateInfo | null> {
  const current = parseVersion(currentVersion);
  if (!current) {
    console.warn('[UpdateChecker] Invalid current version:', currentVersion);
    return null;
  }

  try {
    if (serverUrl) {
      try {
        return await checkViaCodeChat(currentVersion, current, serverUrl);
      } catch (error) {
        console.warn('[UpdateChecker] CodeChat manifest check failed, falling back to GitHub:', error);
      }
    }
    return await checkViaGitHub(currentVersion, current);
  } catch (error) {
    console.warn('[UpdateChecker] Failed to check for updates:', error);
    return null;
  }
}
