/**
 * Tests for AuthService - SSO authentication
 *
 * Covers file storage, login flow, server callback, manual token input, browser opening
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  mkdirSync,
  statSync,
} from "fs";
import * as os from "os";

// ---- http mock with controllable behavior ----
interface MockResponse {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

const httpMockState: {
  fireCallback: boolean;
  code: string;
  handlers: Array<(req: { url: string }, res: MockResponse) => void>;
} = {
  fireCallback: true,
  code: "fake-auth-code",
  handlers: [],
};

vi.mock("http", () => ({
  createServer: vi.fn(
    (handler: (req: { url: string }, res: MockResponse) => void) => {
      httpMockState.handlers.push(handler);
      return {
        listen: vi.fn((_port: number, _host: string, cb: () => void) => {
          cb();
          if (httpMockState.fireCallback) {
            setTimeout(
              () =>
                handler(
                  { url: `/?code=${httpMockState.code}` },
                  { writeHead: () => {}, end: () => {} },
                ),
              10,
            );
          }
        }),
        close: vi.fn((cb?: () => void) => {
          cb?.();
        }),
        address: vi.fn(() => ({
          port: 12345,
          family: "IPv4",
          address: "127.0.0.1",
        })),
      };
    },
  ),
}));

vi.mock("fs");
const mockedExists = vi.mocked(existsSync);
const mockedReadFile = vi.mocked(readFileSync);
const mockedWriteFile = vi.mocked(writeFileSync);
const mockedChmod = vi.mocked(chmodSync);
const mockedRm = vi.mocked(rmSync);
const mockedMkdir = vi.mocked(mkdirSync);
const mockedStat = vi.mocked(statSync);

function resetServiceInstance() {
  (AuthService as unknown as { instance: AuthService }).instance =
    undefined as unknown as AuthService;
}

// Import after mocks are set up
import {
  AuthService,
  createAuthAwareFetch,
  getOrCreateAnonymousId,
  __resetAnonymousIdForTesting,
} from "../../src/services/authService.js";

describe("AuthService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetServiceInstance();
    delete process.env.WAVE_SERVER_URL;
    httpMockState.fireCallback = true;
    httpMockState.code = "fake-auth-code";
    httpMockState.handlers = [];
  });

  afterEach(() => {});

  describe("getAuthPath", () => {
    it("returns ~/.wave/auth.json", () => {
      vi.mocked(os.homedir).mockReturnValue("/home/user");
      const service = AuthService.getInstance();
      expect(service.getAuthPath()).toBe("/home/user/.wave/auth.json");
    });
  });

  describe("loadAuth", () => {
    it("returns empty object when file does not exist", () => {
      mockedExists.mockReturnValue(false);
      const service = AuthService.getInstance();
      expect(service.loadAuth()).toEqual({});
    });

    it("returns parsed JSON when file exists", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({ SSO_TOKEN: "test-token" }),
      );
      const service = AuthService.getInstance();
      expect(service.loadAuth()).toEqual({ SSO_TOKEN: "test-token" });
    });

    it("returns empty object on parse error", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue("invalid json");
      const service = AuthService.getInstance();
      expect(service.loadAuth()).toEqual({});
    });
  });

  describe("saveAuth", () => {
    it("creates directory and writes file with 0o600 permissions", () => {
      mockedExists.mockReturnValueOnce(false).mockReturnValueOnce(true);
      const service = AuthService.getInstance();
      service.saveAuth({ SSO_TOKEN: "new-token" });

      expect(mockedMkdir).toHaveBeenCalledWith("/tmp/.wave", {
        recursive: true,
      });
      expect(mockedWriteFile).toHaveBeenCalledWith(
        "/tmp/.wave/auth.json",
        JSON.stringify({ SSO_TOKEN: "new-token" }, null, 2),
        "utf-8",
      );
      expect(mockedChmod).toHaveBeenCalledWith("/tmp/.wave/auth.json", 0o600);
    });

    it("does not create directory if it already exists", () => {
      mockedExists.mockReturnValue(true);
      const service = AuthService.getInstance();
      service.saveAuth({ SSO_TOKEN: "token" });

      expect(mockedMkdir).not.toHaveBeenCalled();
    });
  });

  describe("clearAuth", () => {
    it("deletes file when SSO_TOKEN is the only key", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "old-refresh",
          SSO_TOKEN_EXPIRES_AT: 1234567890,
        }),
      );
      const service = AuthService.getInstance();
      service.clearAuth();

      expect(mockedRm).toHaveBeenCalledWith("/tmp/.wave/auth.json");
    });

    it("removes SSO_REFRESH_TOKEN and SSO_TOKEN_EXPIRES_AT along with SSO_TOKEN", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_REFRESH_TOKEN: "refresh-token",
          SSO_TOKEN_EXPIRES_AT: 1234567890,
          OTHER_KEY: "value",
        }),
      );
      const service = AuthService.getInstance();
      service.clearAuth();

      expect(mockedWriteFile).toHaveBeenCalledWith(
        "/tmp/.wave/auth.json",
        JSON.stringify({ OTHER_KEY: "value" }, null, 2),
        "utf-8",
      );
      expect(mockedRm).not.toHaveBeenCalled();
    });

    it("saves remaining config when other keys exist", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({ SSO_TOKEN: "token", OTHER_KEY: "value" }),
      );
      const service = AuthService.getInstance();
      service.clearAuth();

      expect(mockedWriteFile).toHaveBeenCalledWith(
        "/tmp/.wave/auth.json",
        JSON.stringify({ OTHER_KEY: "value" }, null, 2),
        "utf-8",
      );
      expect(mockedRm).not.toHaveBeenCalled();
    });

    it("does nothing when file does not exist", () => {
      mockedExists.mockReturnValue(false);
      const service = AuthService.getInstance();
      service.clearAuth();

      expect(mockedRm).not.toHaveBeenCalled();
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("getSSOToken", () => {
    it("returns token when present", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ SSO_TOKEN: "my-token" }));
      const service = AuthService.getInstance();
      expect(service.getSSOToken()).toBe("my-token");
    });

    it("returns undefined when not present", () => {
      mockedExists.mockReturnValue(false);
      const service = AuthService.getInstance();
      expect(service.getSSOToken()).toBeUndefined();
    });
  });

  describe("isSSOAuthenticated", () => {
    it("returns true when token exists", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ SSO_TOKEN: "token" }));
      const service = AuthService.getInstance();
      expect(service.isSSOAuthenticated()).toBe(true);
    });

    it("returns false when no token", () => {
      mockedExists.mockReturnValue(false);
      const service = AuthService.getInstance();
      expect(service.isSSOAuthenticated()).toBe(false);
    });

    it("returns false when token is expired (past SSO_TOKEN_EXPIRES_AT)", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_TOKEN_EXPIRES_AT: Date.now() - 1000,
        }),
      );
      const service = AuthService.getInstance();
      expect(service.isSSOAuthenticated()).toBe(false);
    });

    it("returns true when token exists with future expiry", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 60000,
        }),
      );
      const service = AuthService.getInstance();
      expect(service.isSSOAuthenticated()).toBe(true);
    });
  });

  describe("getAuthUser", () => {
    it("returns user when present in auth.json", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "my-token",
          user: { id: "user-uuid", email: "user@example.com" },
        }),
      );
      const service = AuthService.getInstance();
      expect(service.getAuthUser()).toEqual({
        id: "user-uuid",
        email: "user@example.com",
      });
    });

    it("returns user without email when email is absent", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "my-token",
          user: { id: "user-uuid" },
        }),
      );
      const service = AuthService.getInstance();
      expect(service.getAuthUser()).toEqual({ id: "user-uuid" });
    });

    it("returns undefined when no user in auth.json", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ SSO_TOKEN: "token" }));
      const service = AuthService.getInstance();
      expect(service.getAuthUser()).toBeUndefined();
    });

    it("returns undefined when file does not exist", () => {
      mockedExists.mockReturnValue(false);
      const service = AuthService.getInstance();
      expect(service.getAuthUser()).toBeUndefined();
    });
  });

  describe("getServerUrl", () => {
    it("returns WAVE_SERVER_URL when set", () => {
      process.env.WAVE_SERVER_URL = "https://server.example.com";
      const service = AuthService.getInstance();
      expect(service.getServerUrl()).toBe("https://server.example.com");
    });

    it("throws when WAVE_SERVER_URL is not set", () => {
      const service = AuthService.getInstance();
      expect(() => service.getServerUrl()).toThrow(
        "WAVE_SERVER_URL environment variable is not set",
      );
    });

    it("returns _serverUrl when set via setServerUrl", () => {
      process.env.WAVE_SERVER_URL = "https://env.example.com";
      const service = AuthService.getInstance();
      service.setServerUrl("https://programmatic.example.com");
      expect(service.getServerUrl()).toBe("https://programmatic.example.com");
    });

    it("_serverUrl takes priority over WAVE_SERVER_URL env var", () => {
      process.env.WAVE_SERVER_URL = "https://env.example.com";
      const service = AuthService.getInstance();
      service.setServerUrl("https://options.example.com");
      expect(service.getServerUrl()).toBe("https://options.example.com");
    });

    it("falls back to env var when _serverUrl is not set", () => {
      process.env.WAVE_SERVER_URL = "https://fallback.example.com";
      const service = AuthService.getInstance();
      expect(service.getServerUrl()).toBe("https://fallback.example.com");
    });

    it("throws when neither _serverUrl nor env var is set", () => {
      const service = AuthService.getInstance();
      expect(() => service.getServerUrl()).toThrow(
        "WAVE_SERVER_URL environment variable is not set",
      );
    });
  });

  describe("login with serverUrl option", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      httpMockState.fireCallback = true;
      httpMockState.code = "auth-code";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("uses serverUrl option when provided", async () => {
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "jwt",
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      await service.login({ serverUrl: "https://option.example.com" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://option.example.com/api/auth/token",
        expect.any(Object),
      );
    });

    it("serverUrl option takes priority over setServerUrl", async () => {
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "jwt",
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      service.setServerUrl("https://set.example.com");
      await service.login({ serverUrl: "https://login-option.example.com" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://login-option.example.com/api/auth/token",
        expect.any(Object),
      );
    });

    it("serverUrl option takes priority over env var", async () => {
      process.env.WAVE_SERVER_URL = "https://env.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "jwt",
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      await service.login({ serverUrl: "https://option.example.com" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://option.example.com/api/auth/token",
        expect.any(Object),
      );
    });

    it("falls back to setServerUrl when option not provided", async () => {
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "jwt",
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      service.setServerUrl("https://set.example.com");
      await service.login();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://set.example.com/api/auth/token",
        expect.any(Object),
      );
    });

    it("succeeds with setServerUrl even without env var", async () => {
      // No WAVE_SERVER_URL set
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "jwt-no-env",
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      service.setServerUrl("https://no-env.example.com");
      const token = await service.login();

      expect(token).toBe("jwt-no-env");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://no-env.example.com/api/auth/token",
        expect.any(Object),
      );
    });
  });

  describe("login (callback flow)", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      httpMockState.fireCallback = true;
      httpMockState.code = "callback-auth-code";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("receives callback code via onAuthUrl, exchanges for JWT, and saves it", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(false);
      // exchange code for JWT
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "exchanged-jwt",
          user: { id: "user-uuid", email: "user@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      const onAuthUrl = vi.fn();
      const token = await service.login({ onAuthUrl });

      expect(token).toBe("exchanged-jwt");
      expect(onAuthUrl).toHaveBeenCalled();
      const authUrl = onAuthUrl.mock.calls[0][0] as string;
      expect(authUrl).toContain("/login?callback_url=");
      // Verify exchange endpoint was called with the code
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ai.example.com/api/auth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code: "callback-auth-code",
          }),
        },
      );
      expect(mockedWriteFile).toHaveBeenCalled();
      expect(mockedChmod).toHaveBeenCalled();
    });

    it("throws when code exchange fails", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Invalid or expired code",
      });

      const service = AuthService.getInstance();
      await expect(service.login()).rejects.toThrow(
        "Token exchange failed (400): Invalid or expired code",
      );
    });

    it("preserves existing keys when saving token", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ OTHER_KEY: "value" }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "jwt-token",
          user: { id: "user-uuid", email: "user@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      await service.login();

      const writeCalls = mockedWriteFile.mock.calls;
      const lastWrite = writeCalls[writeCalls.length - 1];
      expect(lastWrite[1]).toContain("OTHER_KEY");
      expect(lastWrite[1]).toContain("SSO_TOKEN");
    });
  });

  describe("login with manual code input", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      httpMockState.fireCallback = false;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("accepts manually provided code via readToken and exchanges for JWT", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(false);
      // exchange code for JWT
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "manual-exchanged-jwt",
          user: { id: "user-uuid", email: "user@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      const token = await service.login({
        readToken: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "manual-code-123";
        },
      });

      expect(token).toBe("manual-exchanged-jwt");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ai.example.com/api/auth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code: "manual-code-123",
          }),
        },
      );
    });

    it("continues waiting for callback when readToken is cancelled", async () => {
      httpMockState.fireCallback = true;
      httpMockState.code = "callback-wins-code";

      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(false);
      // exchange code for JWT
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "callback-wins-jwt",
          user: { id: "user-uuid", email: "user@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      const token = await service.login({
        readToken: async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("cancelled");
        },
      });

      expect(token).toBe("callback-wins-jwt");
    });
  });

  describe("login timeout", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      vi.useFakeTimers();
      httpMockState.fireCallback = false;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it("rejects after 5 minutes if no token received", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(false);

      const service = AuthService.getInstance();

      // Attach catch first to prevent unhandled rejection
      const caughtError = service.login().catch((e) => e);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      const result = await caughtError;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain(
        "SSO authentication timed out after 5 minutes",
      );
    });

    it("can be cancelled before timeout", async () => {
      httpMockState.fireCallback = true;
      httpMockState.code = "early-code";

      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "early-jwt",
          user: { id: "user-uuid", email: "user@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      const loginPromise = service.login();

      // Fire callback before timeout
      await vi.advanceTimersByTimeAsync(50);

      const token = await loginPromise;
      expect(token).toBe("early-jwt");
    });
  });

  describe("singleton", () => {
    it("returns same instance on multiple calls", () => {
      const s1 = AuthService.getInstance();
      const s2 = AuthService.getInstance();
      expect(s1).toBe(s2);
    });
  });

  describe("getOrCreateAnonymousId", () => {
    beforeEach(() => {
      __resetAnonymousIdForTesting();
      vi.resetAllMocks();
    });

    it("reads anonymousId from existing config.json", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({ anonymousId: "persisted-id-123" }),
      );

      const id = getOrCreateAnonymousId();
      expect(id).toBe("persisted-id-123");
      expect(mockedReadFile).toHaveBeenCalledWith(
        expect.stringContaining("config.json"),
        "utf-8",
      );
    });

    it("generates and persists anonymousId when config.json does not exist", () => {
      mockedExists.mockReturnValue(false);

      const id = getOrCreateAnonymousId();

      expect(id).toHaveLength(64); // 32 bytes hex = 64 chars
      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining(".wave"),
        { recursive: true },
      );
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("config.json"),
        expect.stringContaining('"anonymousId"'),
        "utf-8",
      );
      expect(mockedChmod).toHaveBeenCalledWith(
        expect.stringContaining("config.json"),
        0o600,
      );
    });

    it("preserves existing config fields when writing anonymousId", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({ someSetting: true, theme: "dark" }),
      );

      const id = getOrCreateAnonymousId();

      expect(id).toHaveLength(64);
      const written = mockedWriteFile.mock.calls.find((c) =>
        (c[1] as string)?.includes("anonymousId"),
      )?.[1] as string;
      expect(written).toContain("someSetting");
      expect(written).toContain("anonymousId");
    });

    it("generates anonymousId when config exists but has no anonymousId field", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ otherKey: "value" }));

      const id = getOrCreateAnonymousId();
      expect(id).toHaveLength(64);
    });

    it("returns same ID on repeated calls (caching)", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({ anonymousId: "cached-id" }),
      );

      const id1 = getOrCreateAnonymousId();
      const id2 = getOrCreateAnonymousId();
      expect(id1).toBe(id2);
    });

    it("falls back to in-memory ID when file I/O fails", () => {
      mockedExists.mockImplementation(() => {
        throw new Error("I/O error");
      });

      const id = getOrCreateAnonymousId();
      expect(id).toHaveLength(64);
    });
  });

  describe("isTokenExpired", () => {
    it("returns false when no SSO_TOKEN_EXPIRES_AT (backward compat)", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ SSO_TOKEN: "token" }));
      const service = AuthService.getInstance();
      expect(service.isTokenExpired()).toBe(false);
    });

    it("returns false when expiry is in the future", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 60 * 60 * 1000,
        }),
      );
      const service = AuthService.getInstance();
      expect(service.isTokenExpired()).toBe(false);
    });

    it("returns true when expiry is in the past", () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_TOKEN_EXPIRES_AT: Date.now() - 1000,
        }),
      );
      const service = AuthService.getInstance();
      expect(service.isTokenExpired()).toBe(true);
    });

    it("returns true when within 5-minute buffer", () => {
      mockedExists.mockReturnValue(true);
      // 3 minutes from now — within 5-min buffer
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 3 * 60 * 1000,
        }),
      );
      const service = AuthService.getInstance();
      expect(service.isTokenExpired()).toBe(true);
    });
  });

  describe("checkAndRefreshTokenIfNeeded", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns true when token is fresh (no refresh needed)", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 60 * 60 * 1000,
        }),
      );
      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns true when no expiry info (backward compat)", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ SSO_TOKEN: "token" }));
      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("triggers refresh when token is within buffer", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "refresh-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 3 * 60 * 1000,
        }),
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "new-token",
          refreshToken: "new-refresh",
          expiresIn: 3600,
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ai.example.com/api/auth/token",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: "refresh-token",
          }),
        }),
      );
      delete process.env.WAVE_SERVER_URL;
    });

    it("returns false when no refresh token available", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() - 1000,
        }),
      );
      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent calls", async () => {
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "refresh-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 3 * 60 * 1000,
        }),
      );
      let resolveRefresh: (value: unknown) => void;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });
      mockFetch.mockReturnValueOnce(refreshPromise);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "new-token",
          expiresIn: 3600,
          user: { id: "u1" },
        }),
      });

      const service = AuthService.getInstance();
      const p1 = service.checkAndRefreshTokenIfNeeded();
      const p2 = service.checkAndRefreshTokenIfNeeded();

      // Both should share the same refresh call
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resolveRefresh!({
        ok: true,
        json: async () => ({
          token: "new-token",
          expiresIn: 3600,
          user: { id: "u1" },
        }),
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      delete process.env.WAVE_SERVER_URL;
    });
  });

  describe("refreshToken", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.WAVE_SERVER_URL;
    });

    it("saves new token fields on success", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "old-refresh",
          SSO_TOKEN_EXPIRES_AT: Date.now() - 1000,
        }),
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "new-token",
          refreshToken: "new-refresh",
          expiresIn: 3600,
          user: { id: "u1", email: "u@example.com" },
        }),
      });

      // Use checkAndRefreshTokenIfNeeded to trigger refreshToken (it's private)
      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(true);

      // Verify saved data
      const writeCalls = mockedWriteFile.mock.calls;
      const lastWrite = writeCalls[writeCalls.length - 1];
      const saved = JSON.parse(lastWrite[1] as string);
      expect(saved.SSO_TOKEN).toBe("new-token");
      expect(saved.SSO_REFRESH_TOKEN).toBe("new-refresh");
      expect(saved.SSO_TOKEN_EXPIRES_AT).toBeGreaterThan(Date.now());
    });

    it("clears auth on 400 response (refresh token revoked)", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "revoked-refresh",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 3 * 60 * 1000,
        }),
      );
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(false);
      // clearAuth should have been called — file deleted or auth cleared
      expect(mockedRm).toHaveBeenCalled();
    });

    it("returns false on network error without clearing auth", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "refresh-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 3 * 60 * 1000,
        }),
      );
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const service = AuthService.getInstance();
      const result = await service.checkAndRefreshTokenIfNeeded();
      expect(result).toBe(false);
      // Should NOT clear auth — network error might be transient
      expect(mockedRm).not.toHaveBeenCalled();
    });
  });

  describe("createAuthAwareFetch", () => {
    const mockFetch = vi.fn();
    const mockInnerFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      resetServiceInstance();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("calls checkAndRefreshTokenIfNeeded before request", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "fresh-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 60 * 60 * 1000,
        }),
      );
      mockInnerFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const authFetch = createAuthAwareFetch(mockInnerFetch);
      await authFetch("https://api.example.com/test");

      // Token was fresh, no refresh needed, but Authorization header should be set
      expect(mockInnerFetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );
      const callHeaders = mockInnerFetch.mock.calls[0][1].headers as Headers;
      expect(callHeaders.get("Authorization")).toBe("Bearer fresh-token");
    });

    it("retries on 401 after disk refresh", async () => {
      mockedExists.mockReturnValue(true);
      // First loadAuth: token expired, triggers refresh
      mockedReadFile.mockReturnValueOnce(
        JSON.stringify({
          SSO_TOKEN: "expired-token",
          SSO_REFRESH_TOKEN: "refresh-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() - 1000,
        }),
      );
      // For tryReadRefreshedTokenFromDisk — stat says file was updated
      mockedStat.mockReturnValueOnce({
        mtimeMs: Date.now(),
      } as unknown as Awaited<ReturnType<typeof statSync>>);
      // After disk read, token is fresh
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "new-from-disk",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 60 * 60 * 1000,
        }),
      );
      // Refresh call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "refreshed-token",
          expiresIn: 3600,
          user: { id: "u1" },
        }),
      });

      mockInnerFetch.mockResolvedValueOnce(
        new Response("unauthorized", { status: 401 }),
      );
      mockInnerFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const authFetch = createAuthAwareFetch(mockInnerFetch);
      const response = await authFetch("https://api.example.com/test");

      expect(response.status).toBe(200);
      expect(mockInnerFetch).toHaveBeenCalledTimes(2);
    });

    it("returns original 401 when both disk and force refresh fail", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "expired-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() - 1000,
        }),
      );
      // No refresh token — refreshToken() returns false
      mockInnerFetch.mockResolvedValueOnce(
        new Response("unauthorized", { status: 401 }),
      );

      const authFetch = createAuthAwareFetch(mockInnerFetch);
      const response = await authFetch("https://api.example.com/test");

      expect(response.status).toBe(401);
      expect(mockInnerFetch).toHaveBeenCalledTimes(1);
    });

    it("updates Authorization header with fresh token after refresh", async () => {
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValueOnce(
        JSON.stringify({
          SSO_TOKEN: "old-token",
          SSO_REFRESH_TOKEN: "refresh-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 3 * 60 * 1000,
        }),
      );
      // After refresh, loadAuth returns new token
      process.env.WAVE_SERVER_URL = "https://ai.example.com";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "refreshed-token",
          expiresIn: 3600,
          user: { id: "u1" },
        }),
      });
      mockedReadFile.mockReturnValue(
        JSON.stringify({
          SSO_TOKEN: "refreshed-token",
          SSO_TOKEN_EXPIRES_AT: Date.now() + 60 * 60 * 1000,
        }),
      );

      mockInnerFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const authFetch = createAuthAwareFetch(mockInnerFetch);
      await authFetch("https://api.example.com/test");

      const callHeaders = mockInnerFetch.mock.calls[0][1].headers as Headers;
      expect(callHeaders.get("Authorization")).toBe("Bearer refreshed-token");
      delete process.env.WAVE_SERVER_URL;
    });
  });
});
