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
} from "fs";
import * as os from "os";

// ---- http mock with controllable behavior ----
interface MockResponse {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

const httpMockState: {
  fireCallback: boolean;
  token: string;
  handlers: Array<(req: { url: string }, res: MockResponse) => void>;
} = {
  fireCallback: true,
  token: "fake-jwt-token",
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
                  { url: `/?token=${httpMockState.token}` },
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
vi.mock("child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(null);
    },
  ),
}));

const mockedExists = vi.mocked(existsSync);
const mockedReadFile = vi.mocked(readFileSync);
const mockedWriteFile = vi.mocked(writeFileSync);
const mockedChmod = vi.mocked(chmodSync);
const mockedRm = vi.mocked(rmSync);
const mockedMkdir = vi.mocked(mkdirSync);

function resetServiceInstance() {
  (AuthService as unknown as { instance: AuthService }).instance =
    undefined as unknown as AuthService;
}

// Import after mocks are set up
import { AuthService } from "../../src/services/authService.js";

describe("AuthService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetServiceInstance();
    delete process.env.WAVE_ADMIN_URL;
    httpMockState.fireCallback = true;
    httpMockState.token = "fake-jwt-token";
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
        JSON.stringify({ SSO_TOKEN: "old-token" }),
      );
      const service = AuthService.getInstance();
      service.clearAuth();

      expect(mockedRm).toHaveBeenCalledWith("/tmp/.wave/auth.json");
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
  });

  describe("getAdminBaseUrl", () => {
    it("returns WAVE_ADMIN_URL when set", () => {
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      const service = AuthService.getInstance();
      expect(service.getAdminBaseUrl()).toBe("https://admin.example.com");
    });

    it("throws when WAVE_ADMIN_URL is not set", () => {
      const service = AuthService.getInstance();
      expect(() => service.getAdminBaseUrl()).toThrow(
        "WAVE_ADMIN_URL environment variable is not set",
      );
    });
  });

  describe("login (callback flow)", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      httpMockState.fireCallback = true;
      httpMockState.token = "callback-jwt";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fetches providers, opens browser, receives callback token, and saves it", async () => {
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ provider: "netease", displayName: "NetEase SSO" }],
      });

      const service = AuthService.getInstance();
      const onAuthUrl = vi.fn();
      const token = await service.login({ onAuthUrl });

      expect(token).toBe("callback-jwt");
      expect(onAuthUrl).toHaveBeenCalled();
      expect(mockedWriteFile).toHaveBeenCalled();
      expect(mockedChmod).toHaveBeenCalled();
    });

    it("throws when provider fetch fails", async () => {
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Error",
      });

      const service = AuthService.getInstance();
      await expect(service.login()).rejects.toThrow(
        "Failed to fetch SSO providers: 500 Internal Error",
      );
    });

    it("throws when no providers available", async () => {
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

      const service = AuthService.getInstance();
      await expect(service.login()).rejects.toThrow(
        "No SSO providers available",
      );
    });

    it("preserves existing keys when saving token", async () => {
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockedExists.mockReturnValue(true);
      mockedReadFile.mockReturnValue(JSON.stringify({ OTHER_KEY: "value" }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { provider: "provider1", displayName: "Provider 1" },
        ],
      });

      const service = AuthService.getInstance();
      await service.login();

      const writeCalls = mockedWriteFile.mock.calls;
      const lastWrite = writeCalls[writeCalls.length - 1];
      expect(lastWrite[1]).toContain("OTHER_KEY");
      expect(lastWrite[1]).toContain("SSO_TOKEN");
    });
  });

  describe("login with manual token input", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch);
      httpMockState.fireCallback = false;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("accepts manually provided token via readToken", async () => {
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ provider: "netease", displayName: "NetEase SSO" }],
      });

      const service = AuthService.getInstance();
      const token = await service.login({
        readToken: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "manual-token-123";
        },
      });

      expect(token).toBe("manual-token-123");
    });

    it("continues waiting for callback when readToken is cancelled", async () => {
      httpMockState.fireCallback = true;
      httpMockState.token = "callback-wins";

      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ provider: "netease", displayName: "NetEase SSO" }],
      });

      const service = AuthService.getInstance();
      const token = await service.login({
        readToken: async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("cancelled");
        },
      });

      expect(token).toBe("callback-wins");
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
      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ provider: "netease", displayName: "NetEase SSO" }],
      });

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
      httpMockState.token = "early-token";

      process.env.WAVE_ADMIN_URL = "https://admin.example.com";
      mockedExists.mockReturnValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ provider: "netease", displayName: "NetEase SSO" }],
      });

      const service = AuthService.getInstance();
      const loginPromise = service.login();

      // Fire callback before timeout
      await vi.advanceTimersByTimeAsync(50);

      const token = await loginPromise;
      expect(token).toBe("early-token");
    });
  });

  describe("singleton", () => {
    it("returns same instance on multiple calls", () => {
      const s1 = AuthService.getInstance();
      const s2 = AuthService.getInstance();
      expect(s1).toBe(s2);
    });
  });
});
