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
  releaseNotes?: string;
}

function httpGet(
  url: string,
  timeout = 10000,
): Promise<{ statusCode: number; body: string }> {
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
          resolve({ statusCode: res.statusCode || 0, body });
        });
      },
    ).on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function checkViaGitHub(
  currentVersion: string,
  current: ParsedVersion,
): Promise<UpdateInfo | null> {
  const { statusCode, body } = await httpGet(
    "https://api.github.com/repos/netease-lcap/wave-agent/releases/latest",
  );

  if (statusCode !== 200) {
    console.warn(
      "[UpdateChecker] GitHub API returned non-OK status:",
      statusCode,
    );
    return null;
  }

  const data = JSON.parse(body) as {
    tag_name: string;
    html_url: string;
    body?: string;
  };

  const latestTag = data.tag_name.replace(/^v/, "");
  const latest = parseVersion(latestTag);

  if (!latest) {
    console.warn(
      "[UpdateChecker] Invalid latest version from GitHub:",
      data.tag_name,
    );
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
    releaseNotes: undefined,
  };
}

/** Returns UpdateInfo when a newer desktop version exists, null otherwise. */
export async function checkForUpdate(
  currentVersion: string,
  serverUrl?: string,
): Promise<UpdateInfo | null> {
  const current = parseVersion(currentVersion);
  if (!current) {
    console.warn("[UpdateChecker] Invalid current version:", currentVersion);
    return null;
  }

  try {
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
  } catch (error) {
    console.warn("[UpdateChecker] Failed to check for updates:", error);
    return null;
  }
}
