import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { WaveConfiguration } from "../../src/types/configuration.js";

// Mock node:os before importing the module under test
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    isSSOAuthenticated: vi.fn(),
    getSSOToken: vi.fn(),
    getServerUrl: vi.fn(),
    checkAndRefreshTokenIfNeeded: vi.fn().mockResolvedValue(true),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import * as fs from "node:fs";
import { authService } from "../../src/services/authService.js";
import {
  mergeRemoteSettings,
  getRemoteSettingsSync,
  clear,
  shutdown,
  refresh,
  initialize,
  onSettingsUpdate,
  remoteSettingsService,
} from "../../src/services/remoteSettingsService.js";

describe("remoteSettingsService", () => {
  beforeEach(() => {
    // Reset module-level state by calling clear
    clear();
    // Reset fs mocks
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue("");
    (fs.writeFileSync as Mock).mockImplementation(() => {});
    (fs.mkdirSync as Mock).mockImplementation(() => "");
    (fs.unlinkSync as Mock).mockImplementation(() => {});
    // Reset auth mocks
    (authService.isSSOAuthenticated as Mock).mockReturnValue(false);
    (authService.getSSOToken as Mock).mockReturnValue(null);
    (authService.getServerUrl as Mock).mockReturnValue(null);
  });

  afterEach(() => {
    clear();
  });

  // ---------------------------------------------------------------------------
  // getRemoteSettingsSync
  // ---------------------------------------------------------------------------
  describe("getRemoteSettingsSync()", () => {
    it("returns null when no cache is loaded", () => {
      expect(getRemoteSettingsSync()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // fetchRemoteSettings (tested via refresh which calls it)
  // ---------------------------------------------------------------------------
  describe("fetchRemoteSettings()", () => {
    it("skips fetch when not SSO authenticated", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(false);
      const result = await refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Not SSO authenticated");
    });

    it("returns error when SSO authenticated but token missing", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue(null);
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");
      const result = await refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing SSO token or server URL");
    });

    it("returns error when SSO authenticated but serverUrl missing", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue(null);
      const result = await refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing SSO token or server URL");
    });

    it("handles 200 response and saves cache", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      const settings = { language: "en" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "abc",
              settings,
            }),
        }),
      );

      const result = await refresh();
      expect(result.success).toBe(true);
      expect(result.settings).toEqual(settings);
      expect(result.checksum).toBe("abc");
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(getRemoteSettingsSync()).toEqual(settings);
    });

    it("sends If-None-Match header when cached checksum exists", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // First fetch to populate cache with a checksum
      const settings1 = { language: "en" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "etag123",
              settings: settings1,
            }),
        }),
      );
      await refresh();

      // Now cache is populated. Trigger another fetch via initialize (doesn't clear cache).
      const fetchSpy = vi.mocked(fetch);
      fetchSpy.mockResolvedValue({
        status: 304,
      } as Response);

      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // Verify If-None-Match was sent
      const calls = fetchSpy.mock.calls;
      // Find the call that had If-None-Match
      const withEtag = calls.find(
        (call) =>
          (call[1] as RequestInit)?.headers?.[
            "If-None-Match" as keyof HeadersInit
          ],
      );
      expect(withEtag).toBeDefined();
      expect((withEtag![1] as RequestInit).headers).toHaveProperty(
        "If-None-Match",
        "etag123",
      );

      clear();
    });

    it("handles 304 response — returns cached settings", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // Populate cache via disk
      const settings = { language: "en" };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({
          uuid: "u1",
          checksum: "etag123",
          settings,
          fetchedAt: "2024-01-01T00:00:00.000Z",
        }),
      );

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 304,
        }),
      );

      // initialize loads cache from disk, then fetches
      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // After initialize + 304, settings should still be available
      expect(getRemoteSettingsSync()).toEqual(settings);

      clear();
    });

    it("handles 404 response — clears stale cache", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 404,
        }),
      );

      const result = await refresh();
      expect(result.success).toBe(true);
      expect(result.notConfigured).toBe(true);
      expect(result.settings).toBeNull();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("handles non-200/non-304/non-404 response", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 500,
          ok: false,
          text: () => Promise.resolve("server error"),
        }),
      );

      const result = await refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe("HTTP 500");
      expect(result.settings).toBeNull();
    });

    it("handles non-200 response with cached settings available", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // Populate cache via disk
      const settings = { language: "de" };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({
          uuid: "u1",
          checksum: "abc",
          settings,
          fetchedAt: "2024-01-01T00:00:00.000Z",
        }),
      );

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 500,
          ok: false,
          text: () => Promise.resolve("error body"),
        }),
      );

      // initialize loads cache from disk, then fetches
      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // Should fall back to cached settings
      expect(getRemoteSettingsSync()).toEqual(settings);

      clear();
    });

    it("handles network error — uses cache", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // Populate cache via disk
      const settings = { language: "ja" };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({
          uuid: "u1",
          checksum: "abc",
          settings,
          fetchedAt: "2024-01-01T00:00:00.000Z",
        }),
      );

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network failure")),
      );

      initialize();
      await new Promise((r) => setTimeout(r, 50));

      expect(getRemoteSettingsSync()).toEqual(settings);
      clear();
    });

    it("handles network error with non-Error thrown", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string error"));

      const result = await refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });

    it("handles response.text() rejection in non-ok path", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 503,
          ok: false,
          text: () => Promise.reject(new Error("cannot read body")),
        }),
      );

      const result = await refresh();
      expect(result.success).toBe(false);
      expect(result.error).toBe("HTTP 503");
    });
  });

  // ---------------------------------------------------------------------------
  // initialize
  // ---------------------------------------------------------------------------
  describe("initialize()", () => {
    it("loads from disk, fetches, and starts polling", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      const cachedSettings = { language: "zh" };
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({
          uuid: "u1",
          checksum: "old",
          settings: cachedSettings,
          fetchedAt: "2024-01-01T00:00:00.000Z",
        }),
      );

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u2",
              checksum: "new",
              settings: { language: "en" },
            }),
        }),
      );

      initialize();

      // Synchronous: cache loaded from disk
      expect(getRemoteSettingsSync()).toEqual(cachedSettings);

      // Wait for async fetch to complete
      await new Promise((r) => setTimeout(r, 50));

      // After fetch, settings should be updated
      expect(getRemoteSettingsSync()).toEqual({ language: "en" });

      clear();
    });

    it("starts polling even if initial fetch fails", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // Polling should still be started (no crash)
      shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // refresh
  // ---------------------------------------------------------------------------
  describe("refresh()", () => {
    it("clears in-memory and disk cache then fetches fresh", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      const newSettings = { language: "ko" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "fresh",
              settings: newSettings,
            }),
        }),
      );

      const result = await refresh();
      expect(result.success).toBe(true);
      expect(result.settings).toEqual(newSettings);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------
  describe("clear()", () => {
    it("removes cache from memory and disk, stops polling", () => {
      clear();
      expect(getRemoteSettingsSync()).toBeNull();
    });

    it("removes cache file when it exists", () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      clear();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // shutdown
  // ---------------------------------------------------------------------------
  describe("shutdown()", () => {
    it("stops polling timer", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "abc",
              settings: { language: "en" },
            }),
        }),
      );

      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // Should not throw
      shutdown();

      // Calling shutdown again should be safe (no timer to clear)
      shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // onSettingsUpdate (hot-update callback)
  // ---------------------------------------------------------------------------
  describe("onSettingsUpdate()", () => {
    it("fires callback when checksum changes on 200 response", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      const callback = vi.fn();
      const unsubscribe = onSettingsUpdate(callback);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "new-checksum",
              settings: { language: "en" },
            }),
        }),
      );

      await refresh();
      expect(callback).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("does not fire callback on 304 (unchanged)", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // First fetch to populate cache
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "etag1",
              settings: { language: "en" },
            }),
        }),
      );
      await refresh();

      const callback = vi.fn();
      const unsubscribe = onSettingsUpdate(callback);

      // Second fetch returns 304 (unchanged)
      vi.mocked(fetch).mockResolvedValue({
        status: 304,
      } as Response);
      await refresh();

      expect(callback).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("does not fire callback when checksum is same as before", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // First fetch with checksum "same"
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "same",
              settings: { language: "en" },
            }),
        }),
      );
      await refresh();

      const callback = vi.fn();
      const unsubscribe = onSettingsUpdate(callback);

      // Second fetch with same checksum — note refresh() clears cache first,
      // so oldChecksum is undefined. We test via initialize() path instead.
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            uuid: "u1",
            checksum: "same",
            settings: { language: "en" },
          }),
      } as Response);
      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // initialize() doesn't clear cache, so oldChecksum = "same", new = "same" → no callback
      expect(callback).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("fires callback when settings cleared via 404 response", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // First fetch to populate cache with a checksum
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "will-be-cleared",
              settings: { language: "en" },
            }),
        }),
      );
      await refresh();
      expect(getRemoteSettingsSync()).not.toBeNull();

      const callback = vi.fn();
      const unsubscribe = onSettingsUpdate(callback);

      // Second fetch returns 404 — settings removed on server
      vi.mocked(fetch).mockResolvedValue({
        status: 404,
        ok: false,
      } as Response);
      initialize();
      await new Promise((r) => setTimeout(r, 50));

      expect(callback).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("unsubscribe stops callback from firing", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      const callback = vi.fn();
      const unsubscribe = onSettingsUpdate(callback);
      unsubscribe();

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "after-unsub",
              settings: { language: "en" },
            }),
        }),
      );
      await refresh();

      expect(callback).not.toHaveBeenCalled();
    });

    it("callback errors do not break the fetch flow", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      const errorCallback = vi.fn().mockRejectedValue(new Error("boom"));
      const unsubscribe = onSettingsUpdate(errorCallback);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "err-test",
              settings: { language: "en" },
            }),
        }),
      );

      // Should not throw despite callback error
      const result = await refresh();
      expect(result.success).toBe(true);
      expect(errorCallback).toHaveBeenCalled();
      unsubscribe();
    });

    it("is exposed on the remoteSettingsService singleton", () => {
      expect(remoteSettingsService.onSettingsUpdate).toBeTypeOf("function");
    });
  });

  // ---------------------------------------------------------------------------
  // mergeRemoteSettings
  // ---------------------------------------------------------------------------
  describe("mergeRemoteSettings()", () => {
    it("merges env: remote wins per-key, local preserved", () => {
      const local = { env: { A: "local-a", B: "local-b" } };
      const remote = { env: { B: "remote-b", C: "remote-c" } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.env).toEqual({
        A: "local-a",
        B: "remote-b",
        C: "remote-c",
      });
    });

    it("merges env when only local has env", () => {
      const local = { env: { A: "a" } };
      const remote = {};
      const result = mergeRemoteSettings(local, remote);
      expect(result.env).toEqual({ A: "a" });
    });

    it("merges env when only remote has env", () => {
      const local = {};
      const remote = { env: { A: "a" } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.env).toEqual({ A: "a" });
    });

    it("merges permissions.allow: concatenate + dedupe", () => {
      const local = { permissions: { allow: ["a", "b"] } };
      const remote = { permissions: { allow: ["b", "c"] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.allow).toEqual(["a", "b", "c"]);
    });

    it("merges permissions.deny: concatenate + dedupe", () => {
      const local = { permissions: { deny: ["x"] } };
      const remote = { permissions: { deny: ["x", "y"] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.deny).toEqual(["x", "y"]);
    });

    it("merges permissions.permissionMode: remote wins", () => {
      const local = { permissions: { permissionMode: "default" as const } };
      const remote = { permissions: { permissionMode: "plan" as const } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.permissionMode).toBe("plan");
    });

    it("merges permissions.permissionMode: falls back to local when remote undefined", () => {
      const local = { permissions: { permissionMode: "default" as const } };
      const remote = { permissions: {} };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.permissionMode).toBe("default");
    });

    it("merges permissions.additionalDirectories: concatenate + dedupe", () => {
      const local = { permissions: { additionalDirectories: ["/a", "/b"] } };
      const remote = { permissions: { additionalDirectories: ["/b", "/c"] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.additionalDirectories).toEqual([
        "/a",
        "/b",
        "/c",
      ]);
    });

    it("merges permissions when only local has permissions", () => {
      const local = { permissions: { allow: ["a"] } };
      const remote = {};
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.allow).toEqual(["a"]);
    });

    it("merges permissions when only remote has permissions", () => {
      const local = {};
      const remote = { permissions: { deny: ["x"] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions!.deny).toEqual(["x"]);
    });

    it("cleans up undefined permission keys", () => {
      const local = { permissions: { allow: ["a"] } };
      const remote = { permissions: { allow: ["b"] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.permissions).not.toHaveProperty("deny");
      expect(result.permissions).not.toHaveProperty("permissionMode");
      expect(result.permissions).not.toHaveProperty("additionalDirectories");
    });

    it("merges hooks: concatenate per-event + dedupe", () => {
      const hook1 = {
        matcher: "Bash",
        hooks: [{ command: "echo hello", type: "command" as const }],
      };
      const hook2 = {
        matcher: "Read",
        hooks: [{ command: "echo bye", type: "command" as const }],
      };
      const hook1dup = {
        matcher: "Bash",
        hooks: [{ command: "echo hello", type: "command" as const }],
      };

      const local = { hooks: { PreToolUse: [hook1] } };
      const remote = { hooks: { PreToolUse: [hook1dup, hook2] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.hooks!.PreToolUse).toHaveLength(2);
      expect(result.hooks!.PreToolUse![0]).toEqual(hook1);
      expect(result.hooks!.PreToolUse![1]).toEqual(hook2);
    });

    it("merges hooks when only local has hooks", () => {
      const hook = {
        hooks: [{ command: "echo", type: "command" as const }],
      };
      const local = { hooks: { PreToolUse: [hook] } };
      const remote = {};
      const result = mergeRemoteSettings(local, remote);
      expect(result.hooks).toEqual({ PreToolUse: [hook] });
    });

    it("merges hooks when only remote has hooks", () => {
      const hook = {
        hooks: [{ command: "echo", type: "command" as const }],
      };
      const local = {};
      const remote = { hooks: { PostToolUse: [hook] } };
      const result = mergeRemoteSettings(local, remote);
      expect(result.hooks).toEqual({ PostToolUse: [hook] });
    });

    it("returns undefined hooks when both are undefined", () => {
      const local = {};
      const remote = {};
      const result = mergeRemoteSettings(local, remote);
      expect(result.hooks).toBeUndefined();
    });

    it("merges scalar fields: remote wins when defined", () => {
      const local = {
        language: "en",
        autoMemoryEnabled: true,
        autoMemoryFrequency: 5,
        models: { model: { maxTokens: 50 } },
        marketplaces: { m1: { source: "url" as const } },
        enabledPlugins: { p1: true },
      };
      const remote = {
        language: "ja",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 10,
        models: { model: { maxTokens: 100 } },
        marketplaces: { m2: { source: "url" as const } },
        enabledPlugins: { p2: true },
      };
      const result = mergeRemoteSettings(
        local as unknown as WaveConfiguration,
        remote as unknown as WaveConfiguration,
      );
      expect(result.language).toBe("ja");
      expect(result.autoMemoryEnabled).toBe(false);
      expect(result.autoMemoryFrequency).toBe(10);
      expect(result.models).toEqual({ model: { maxTokens: 100 } });
      expect(result.marketplaces).toEqual({ m2: { source: "url" } });
      expect(result.enabledPlugins).toEqual({ p2: true });
    });

    it("preserves local scalar fields when remote doesn't define them", () => {
      const local = {
        language: "en",
        autoMemoryEnabled: true,
        autoMemoryFrequency: 5,
        models: { model: { maxTokens: 50 } },
        marketplaces: { m1: { source: "url" as const } },
        enabledPlugins: { p1: true },
      };
      const remote = {};
      const result = mergeRemoteSettings(
        local as unknown as WaveConfiguration,
        remote as unknown as WaveConfiguration,
      );
      expect(result.language).toBe("en");
      expect(result.autoMemoryEnabled).toBe(true);
      expect(result.autoMemoryFrequency).toBe(5);
      expect(result.models).toEqual({ model: { maxTokens: 50 } });
      expect(result.marketplaces).toEqual({ m1: { source: "url" } });
      expect(result.enabledPlugins).toEqual({ p1: true });
    });

    it("handles both empty objects", () => {
      const result = mergeRemoteSettings({}, {});
      expect(result).toEqual({});
    });

    it("handles empty local with remote data", () => {
      const remote = {
        language: "ja",
        env: { X: "1" },
        permissions: { allow: ["a"] },
      };
      const result = mergeRemoteSettings({}, remote);
      expect(result.language).toBe("ja");
      expect(result.env).toEqual({ X: "1" });
      expect(result.permissions!.allow).toEqual(["a"]);
    });

    it("handles remote with undefined scalar values (should not overwrite)", () => {
      const local = { language: "en" };
      const remote = { language: undefined };
      const result = mergeRemoteSettings(local, remote);
      expect(result.language).toBe("en");
    });

    it("merges model: remote model overrides local model", () => {
      const local = { model: "local-model" } as unknown as WaveConfiguration;
      const remote = { model: "remote-model" } as unknown as WaveConfiguration;
      const result = mergeRemoteSettings(local, remote);
      expect(result.model).toBe("remote-model");
    });

    it("merges model: local model preserved when remote has no model", () => {
      const local = { model: "local-model" } as unknown as WaveConfiguration;
      const remote = {} as unknown as WaveConfiguration;
      const result = mergeRemoteSettings(local, remote);
      expect(result.model).toBe("local-model");
    });
  });

  // ---------------------------------------------------------------------------
  // remoteSettingsService namespace object
  // ---------------------------------------------------------------------------
  describe("remoteSettingsService namespace", () => {
    it("exposes all expected methods", () => {
      expect(remoteSettingsService.initialize).toBeTypeOf("function");
      expect(remoteSettingsService.getRemoteSettingsSync).toBeTypeOf(
        "function",
      );
      expect(remoteSettingsService.refresh).toBeTypeOf("function");
      expect(remoteSettingsService.clear).toBeTypeOf("function");
      expect(remoteSettingsService.shutdown).toBeTypeOf("function");
      expect(remoteSettingsService.mergeRemoteSettings).toBeTypeOf("function");
    });
  });

  // ---------------------------------------------------------------------------
  // loadCacheFromDisk edge cases
  // ---------------------------------------------------------------------------
  describe("loadCacheFromDisk edge cases", () => {
    it("skips loading when cache file does not exist", async () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      initialize();
      await new Promise((r) => setTimeout(r, 50));
      clear();
    });

    it("handles corrupt cache file gracefully", async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue("not valid json {{{");

      initialize();
      await new Promise((r) => setTimeout(r, 50));
      clear();
    });
  });

  // ---------------------------------------------------------------------------
  // writeCacheToDisk edge cases
  // ---------------------------------------------------------------------------
  describe("writeCacheToDisk edge cases", () => {
    it("creates directory if it doesn't exist", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // existsSync returns false for both cache file and directory checks
      (fs.existsSync as Mock).mockReturnValue(false);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "abc",
              settings: { language: "en" },
            }),
        }),
      );

      await refresh();
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it("handles write failure gracefully", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      (fs.writeFileSync as Mock).mockImplementation(() => {
        throw new Error("disk full");
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "abc",
              settings: { language: "en" },
            }),
        }),
      );

      const result = await refresh();
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // removeCacheFromDisk edge cases
  // ---------------------------------------------------------------------------
  describe("removeCacheFromDisk edge cases", () => {
    it("does nothing when cache file doesn't exist", () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      (fs.unlinkSync as Mock).mockClear();
      clear();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("handles unlink error gracefully", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      // Populate cache
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "abc",
              settings: { language: "en" },
            }),
        }),
      );
      await refresh();

      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.unlinkSync as Mock).mockImplementation(() => {
        throw new Error("permission denied");
      });

      // Should not throw
      clear();
    });
  });

  // ---------------------------------------------------------------------------
  // startPolling — second call is no-op
  // ---------------------------------------------------------------------------
  describe("startPolling idempotency", () => {
    it("does not start duplicate timers on multiple initialize calls", async () => {
      (authService.isSSOAuthenticated as Mock).mockReturnValue(true);
      (authService.getSSOToken as Mock).mockReturnValue("token123");
      (authService.getServerUrl as Mock).mockReturnValue("https://server.test");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              uuid: "u1",
              checksum: "abc",
              settings: { language: "en" },
            }),
        }),
      );

      initialize();
      await new Promise((r) => setTimeout(r, 50));

      // Call initialize again — should not create a second timer
      initialize();
      await new Promise((r) => setTimeout(r, 50));

      clear();
    });
  });
});
