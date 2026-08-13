/**
 * Update checker for the desktop app — queries GitHub Releases (or the
 * CodeChat electron-builder download feed when a serverUrl is configured).
 * Ported from packages/vscode/src/services/updateService.ts without the
 * VS Code-specific notification/install code.
 */

import * as http from "http";
import * as https from "https";
import { load as parseYaml } from "js-yaml";
import { parseVersion, compareVersions, type ParsedVersion } from "./version";

export interface UpdateInfo {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
}

function httpGet(
  url: string,
  timeout = 10000,
): Promise<{ statusCode: number; body: string; headers: NodeJS.Dict<string | string[]> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Request timed out"));
    }, timeout);

    const getter = url.startsWith("https:") ? https.get : http.get;
    getter(
      url,
      {
        headers: { "User-Agent": "Wave-Desktop" },
        timeout,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ statusCode: res.statusCode || 0, body, headers: res.headers });
        });
      },
    ).on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Check the latest release via the HTML endpoint instead of the REST API:
 * `https://github.com/<owner>/<repo>/releases/latest` 302-redirects to the
 * newest non-prerelease tag (same semantics as the API) but is NOT subject to
 * the unauthenticated API rate limit (60 req/h per IP) that made the old check
 * fail with 403 from shared/CGNAT addresses — which was reported as "no
 * update". Throws when the redirect can't be resolved so callers can
 * distinguish "check failed" from "already up to date".
 */
async function checkViaGitHub(
  currentVersion: string,
  current: ParsedVersion,
): Promise<UpdateInfo | null> {
  const { statusCode, headers } = await httpGet(
    "https://github.com/netease-lcap/wave-agent/releases/latest",
  );
  const location =
    typeof headers.location === "string" ? headers.location : "";
  if (statusCode < 300 || statusCode >= 400 || !location) {
    throw new Error(
      `GitHub releases redirect failed with status ${statusCode}`,
    );
  }

  // location: https://github.com/netease-lcap/wave-agent/releases/tag/v1.0.8
  const latestTag = location.slice(location.lastIndexOf("/") + 1);
  const latest = parseVersion(latestTag);

  if (!latest) {
    console.warn(
      "[UpdateChecker] Invalid latest version from GitHub:",
      latestTag,
    );
    return null;
  }

  if (compareVersions(latest, current) > 0) {
    return {
      latestVersion: latestTag.replace(/^v/, ""),
      currentVersion,
      downloadUrl: location,
    };
  }

  return null;
}

async function checkViaCodeChat(
  currentVersion: string,
  current: ParsedVersion,
  serverUrl: string,
): Promise<UpdateInfo | null> {
  // The codechat downloads endpoint serves electron-builder metadata:
  // mac → latest-mac.yml, win → latest.yml. The `path` field is the absolute
  // download entry (e.g. a file-center URL) — pointing users at the metadata
  // itself would be useless.
  const platform = process.platform === "win32" ? "win" : "mac";
  const fileName =
    process.platform === "win32" ? "latest.yml" : "latest-mac.yml";
  const feedUrl = `${serverUrl}/api/downloads/desktop/${platform}/${fileName}`;

  const { statusCode, body } = await httpGet(feedUrl, 5000);

  if (statusCode !== 200) {
    throw new Error(
      `CodeChat download feed returned non-OK status: ${statusCode}`,
    );
  }

  let data: { version?: unknown; path?: unknown };
  try {
    data = parseYaml(body) as { version?: unknown; path?: unknown };
  } catch (error) {
    console.warn(
      "[UpdateChecker] Failed to parse CodeChat download feed:",
      error,
    );
    return null;
  }

  if (typeof data.version !== "string") {
    console.warn(
      "[UpdateChecker] Invalid latest version from CodeChat:",
      data.version,
    );
    return null;
  }

  const latest = parseVersion(data.version);
  if (!latest) {
    console.warn(
      "[UpdateChecker] Invalid latest version from CodeChat:",
      data.version,
    );
    return null;
  }

  if (compareVersions(latest, current) <= 0) {
    return null;
  }

  return {
    latestVersion: data.version,
    currentVersion,
    downloadUrl: typeof data.path === "string" ? data.path : feedUrl,
  };
}

/**
 * Returns UpdateInfo when a newer desktop version exists, null when the check
 * succeeded and the app is up to date. Throws when the check failed (network
 * error, non-OK status) so callers don't mistake a failure for "no update".
 */
export async function checkForUpdate(
  currentVersion: string,
  serverUrl?: string,
): Promise<UpdateInfo | null> {
  const current = parseVersion(currentVersion);
  if (!current) {
    console.warn("[UpdateChecker] Invalid current version:", currentVersion);
    return null;
  }

  if (serverUrl) {
    try {
      return await checkViaCodeChat(currentVersion, current, serverUrl);
    } catch (error) {
      console.warn(
        "[UpdateChecker] CodeChat download feed check failed, falling back to GitHub:",
        error,
      );
    }
  }
  return await checkViaGitHub(currentVersion, current);
}
