import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

type Handler = (
  url: string,
) =>
  | { statusCode: number; body: string; headers?: Record<string, string> }
  | Error;

const h = vi.hoisted(() => ({
  handler: null as Handler | null,
  requestedUrls: [] as string[],
}));

function makeRequest(module: "http" | "https") {
  return vi.fn(
    (url: string, _options: unknown, callback: (res: unknown) => void) => {
      h.requestedUrls.push(`${module}:${url}`);
      const result = h.handler?.(url) ?? new Error("no handler configured");
      if (result instanceof Error) {
        const req = new EventEmitter();
        queueMicrotask(() => req.emit("error", result));
        return req;
      }
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
      };
      res.statusCode = result.statusCode;
      res.headers = result.headers ?? {};
      queueMicrotask(() => {
        callback(res);
        res.emit("data", result.body);
        res.emit("end");
      });
      return { on: vi.fn() };
    },
  );
}

vi.mock("https", () => ({ get: makeRequest("https") }));
vi.mock("http", () => ({ get: makeRequest("http") }));

import { checkForUpdate } from "../src/main/updateChecker";

const GITHUB_LATEST =
  "https://github.com/netease-lcap/wave-agent/releases/latest";

/** A 302 redirect to the given release tag, as GitHub serves for /releases/latest. */
function githubRedirect(tag: string) {
  return {
    statusCode: 302,
    body: "",
    headers: { location: `https://github.com/netease-lcap/wave-agent/releases/tag/${tag}` },
  };
}

beforeEach(() => {
  h.handler = null;
  h.requestedUrls = [];
});

describe("checkForUpdate via GitHub", () => {
  it("returns UpdateInfo when the latest release is newer", async () => {
    h.handler = () => githubRedirect("v1.0.8");

    const info = await checkForUpdate("1.0.7");
    expect(info).toEqual({
      latestVersion: "1.0.8",
      currentVersion: "1.0.7",
      downloadUrl:
        "https://github.com/netease-lcap/wave-agent/releases/tag/v1.0.8",
    });
  });

  it("returns null when already up to date", async () => {
    h.handler = () => githubRedirect("v1.0.7");
    expect(await checkForUpdate("1.0.7")).toBeNull();
  });

  it("returns null when the latest release is older", async () => {
    h.handler = () => githubRedirect("v1.0.6");
    expect(await checkForUpdate("1.0.7")).toBeNull();
  });

  it("throws when the redirect cannot be resolved", async () => {
    // e.g. a non-3xx status (the old API endpoint would 403 rate-limit)
    h.handler = () => ({ statusCode: 403, body: "{}" });
    await expect(checkForUpdate("1.0.7")).rejects.toThrow();
  });

  it("throws on network error", async () => {
    h.handler = () => new Error("ECONNREFUSED");
    await expect(checkForUpdate("1.0.7")).rejects.toThrow();
  });

  it("returns null for an invalid current version", async () => {
    expect(await checkForUpdate("not-a-version")).toBeNull();
    expect(h.requestedUrls).toEqual([]);
  });
});

describe("checkForUpdate via CodeChat download feed", () => {
  const SERVER = "https://codechat.example.com";
  // Mirror checkViaCodeChat: the feed file depends on the host platform.
  const platform = process.platform === "win32" ? "win" : "mac";
  const fileName =
    process.platform === "win32" ? "latest.yml" : "latest-mac.yml";
  const FEED_URL = `${SERVER}/api/downloads/desktop/${platform}/${fileName}`;

  it("returns UpdateInfo parsed from the YAML feed when newer", async () => {
    h.handler = (url) => {
      if (url.startsWith(SERVER)) {
        return {
          statusCode: 200,
          body: `version: 1.0.0\nfiles:\n  - url: wave-1.0.0.dmg\npath: https://file-center.example.com/wave-1.0.0.dmg\n`,
        };
      }
      return new Error(`unexpected url: ${url}`);
    };

    const info = await checkForUpdate("0.19.7", SERVER);
    expect(info?.latestVersion).toBe("1.0.0");
    // The downloadUrl must point at the real download entry, not the feed itself.
    expect(info?.downloadUrl).toBe(
      "https://file-center.example.com/wave-1.0.0.dmg",
    );
    expect(h.requestedUrls).toEqual([`https:${FEED_URL}`]);
  });

  it("falls back to the feed URL when the feed has no path field", async () => {
    h.handler = () => ({ statusCode: 200, body: "version: 1.0.0\n" });

    const info = await checkForUpdate("0.19.7", SERVER);
    expect(info?.latestVersion).toBe("1.0.0");
    expect(info?.downloadUrl).toBe(FEED_URL);
  });

  it("returns null when the feed version is not newer", async () => {
    h.handler = () => ({ statusCode: 200, body: "version: 0.19.7\n" });
    expect(await checkForUpdate("0.19.7", SERVER)).toBeNull();
  });

  it("falls back to GitHub when the feed check fails", async () => {
    h.handler = (url) => {
      if (url.startsWith(SERVER)) {
        return { statusCode: 500, body: "" };
      }
      if (url === GITHUB_LATEST) {
        return githubRedirect("v0.20.0");
      }
      return new Error(`unexpected url: ${url}`);
    };

    const info = await checkForUpdate("0.19.7", SERVER);
    expect(info?.latestVersion).toBe("0.20.0");
    expect(h.requestedUrls).toEqual([
      `https:${FEED_URL}`,
      `https:${GITHUB_LATEST}`,
    ]);
  });
});
