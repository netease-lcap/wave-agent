import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import { authService, createAuthAwareFetch } from "./authService.js";
import type {
  RemoteSettingsCache,
  RemoteSettingsFetchResult,
  RemoteSettingsResponse,
} from "../types/configuration.js";
import type { WaveConfiguration } from "../types/configuration.js";
import type { HookEvent, HookEventConfig } from "../types/hooks.js";
import { logger } from "../utils/globalLogger.js";

const CACHE_FILE = path.join(homedir(), ".wave", "remote-settings.json");
const POLLING_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const FETCH_TIMEOUT_MS = 10_000;

let _cachedSettings: RemoteSettingsCache | null = null;
let _pollingTimer: ReturnType<typeof setInterval> | null = null;

function loadCacheFromDisk(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return;
    }
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const parsed: RemoteSettingsCache = JSON.parse(raw);
    _cachedSettings = parsed;
    logger.debug("remoteSettings: loaded cache from disk", {
      checksum: parsed.checksum,
    });
  } catch (err) {
    logger.debug("remoteSettings: failed to load cache from disk", { err });
  }
}

function writeCacheToDisk(): void {
  if (!_cachedSettings) {
    return;
  }
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(_cachedSettings, null, 2), {
      mode: 0o600,
    });
    logger.debug("remoteSettings: wrote cache to disk", {
      checksum: _cachedSettings.checksum,
    });
  } catch (err) {
    logger.debug("remoteSettings: failed to write cache to disk", { err });
  }
}

function removeCacheFromDisk(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch (err) {
    logger.debug("remoteSettings: failed to remove cache file", { err });
  }
}

async function fetchRemoteSettings(): Promise<RemoteSettingsFetchResult> {
  if (!authService.isSSOAuthenticated()) {
    logger.debug("remoteSettings: skipping fetch — not SSO authenticated");
    return { success: false, error: "Not SSO authenticated" };
  }

  const token = authService.getSSOToken();
  const serverUrl = authService.getServerUrl();
  if (!token || !serverUrl) {
    return { success: false, error: "Missing SSO token or server URL" };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (_cachedSettings?.checksum) {
    headers["If-None-Match"] = _cachedSettings.checksum;
  }

  try {
    const authFetch = createAuthAwareFetch(globalThis.fetch);
    const response = await authFetch(`${serverUrl}/api/wave/settings`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status === 304) {
      logger.debug("remoteSettings: 304 unchanged", {
        checksum: _cachedSettings?.checksum,
      });
      return {
        success: true,
        settings: _cachedSettings!.settings,
        checksum: _cachedSettings!.checksum,
      };
    }

    if (response.status === 404) {
      logger.debug("remoteSettings: 404 not configured — clearing stale cache");
      _cachedSettings = null;
      removeCacheFromDisk();
      return { success: true, notConfigured: true, settings: null };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.debug("remoteSettings: fetch failed", {
        status: response.status,
        body: body.slice(0, 200),
      });
      return {
        success: false,
        error: `HTTP ${response.status}`,
        settings: _cachedSettings?.settings ?? null,
      };
    }

    const data = (await response.json()) as RemoteSettingsResponse;
    _cachedSettings = {
      uuid: data.uuid,
      checksum: data.checksum,
      settings: data.settings,
      fetchedAt: new Date().toISOString(),
    };
    writeCacheToDisk();
    logger.debug("remoteSettings: fetched new settings", {
      checksum: data.checksum,
    });
    return {
      success: true,
      settings: data.settings,
      checksum: data.checksum,
    };
  } catch (err) {
    logger.debug("remoteSettings: network error, using cache", { err });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      settings: _cachedSettings?.settings ?? null,
    };
  }
}

function startPolling(): void {
  if (_pollingTimer) {
    return;
  }
  _pollingTimer = setInterval(async () => {
    try {
      await fetchRemoteSettings();
    } catch (err) {
      logger.debug("remoteSettings: polling fetch error", { err });
    }
  }, POLLING_INTERVAL_MS);
  _pollingTimer.unref();
}

export function initialize(): void {
  loadCacheFromDisk();
  // Fire-and-forget the initial fetch, then start background polling
  fetchRemoteSettings()
    .then(() => startPolling())
    .catch((err) => {
      logger.debug("remoteSettings: initial fetch failed", { err });
      startPolling();
    });
}

export function getRemoteSettingsSync(): WaveConfiguration | null {
  return _cachedSettings?.settings ?? null;
}

export async function refresh(): Promise<RemoteSettingsFetchResult> {
  // Clear in-memory so we force a fresh fetch
  _cachedSettings = null;
  removeCacheFromDisk();
  return fetchRemoteSettings();
}

export function clear(): void {
  _cachedSettings = null;
  removeCacheFromDisk();
  if (_pollingTimer) {
    clearInterval(_pollingTimer);
    _pollingTimer = null;
  }
}

export function shutdown(): void {
  if (_pollingTimer) {
    clearInterval(_pollingTimer);
    _pollingTimer = null;
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function mergeHooks(
  local: Partial<Record<HookEvent, HookEventConfig[]>> | undefined,
  remote: Partial<Record<HookEvent, HookEventConfig[]>> | undefined,
): Partial<Record<HookEvent, HookEventConfig[]>> | undefined {
  if (!remote && !local) {
    return undefined;
  }
  if (!remote) {
    return local;
  }
  if (!local) {
    return remote;
  }
  const merged: Partial<Record<HookEvent, HookEventConfig[]>> = { ...local };
  for (const [event, remoteHooks] of Object.entries(remote)) {
    const localHooks = merged[event as HookEvent] ?? [];
    // Concatenate + dedupe by JSON serialization
    const combined = [...localHooks, ...(remoteHooks ?? [])];
    const seen = new Set<string>();
    merged[event as HookEvent] = combined.filter((h) => {
      const key = JSON.stringify(h);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  return merged;
}

export function mergeRemoteSettings(
  localMerged: WaveConfiguration,
  remote: WaveConfiguration,
): WaveConfiguration {
  const result: WaveConfiguration = { ...localMerged };

  // env: merge by key, remote wins per-key
  if (remote.env || localMerged.env) {
    result.env = { ...localMerged.env, ...remote.env };
  }

  // permissions
  if (remote.permissions || localMerged.permissions) {
    const lp = localMerged.permissions ?? {};
    const rp = remote.permissions ?? {};
    result.permissions = {
      // allow: concatenate + dedupe
      allow:
        lp.allow || rp.allow
          ? dedupe([...(lp.allow ?? []), ...(rp.allow ?? [])])
          : undefined,
      // deny: concatenate + dedupe
      deny:
        lp.deny || rp.deny
          ? dedupe([...(lp.deny ?? []), ...(rp.deny ?? [])])
          : undefined,
      // permissionMode: remote wins (scalar)
      permissionMode: rp.permissionMode ?? lp.permissionMode,
      // additionalDirectories: concatenate + dedupe
      additionalDirectories:
        lp.additionalDirectories || rp.additionalDirectories
          ? dedupe([
              ...(lp.additionalDirectories ?? []),
              ...(rp.additionalDirectories ?? []),
            ])
          : undefined,
    };
    // Clean up undefined keys
    if (!result.permissions.allow) delete result.permissions.allow;
    if (!result.permissions.deny) delete result.permissions.deny;
    if (!result.permissions.permissionMode)
      delete result.permissions.permissionMode;
    if (!result.permissions.additionalDirectories)
      delete result.permissions.additionalDirectories;
  }

  // hooks: concatenate per-event
  result.hooks = mergeHooks(localMerged.hooks, remote.hooks);

  // Scalar / last-write-wins fields: remote wins
  if (remote.language !== undefined) result.language = remote.language;
  if (remote.model !== undefined) result.model = remote.model;
  if (remote.autoMemoryEnabled !== undefined)
    result.autoMemoryEnabled = remote.autoMemoryEnabled;
  if (remote.autoMemoryFrequency !== undefined)
    result.autoMemoryFrequency = remote.autoMemoryFrequency;
  if (remote.models !== undefined) result.models = remote.models;
  if (remote.marketplaces !== undefined)
    result.marketplaces = remote.marketplaces;
  if (remote.enabledPlugins !== undefined)
    result.enabledPlugins = remote.enabledPlugins;

  return result;
}

/**
 * Singleton object for consumers that prefer a namespace-style import.
 * Usage: import { remoteSettingsService } from "./remoteSettingsService.js"
 */
export const remoteSettingsService = {
  initialize,
  getRemoteSettingsSync,
  refresh,
  clear,
  shutdown,
  mergeRemoteSettings,
} as const;
