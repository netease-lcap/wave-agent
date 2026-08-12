import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

type Handler = (url: string) => { statusCode: number; body: string } | Error;

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
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = result.statusCode;
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
  "https://api.github.com/repos/netease-lcap/wave-agent/releases/latest";

beforeEach(() => {
  h.handler = null;
  h.requestedUrls = [];
});

describe("checkForUpdate via GitHub", () => {
  it("returns UpdateInfo when the latest release is newer", async () => {
    h.handler = () => ({
      statusCode: 200,
      body: JSON.stringify({
        tag_name: "v0.20.0",
        html_url: "https://github.com/release/v0.20.0",
        body: "notes",
      }),
    });

    const info = await checkForUpdate("0.19.7");
    expect(info).toEqual({
      latestVersion: "0.20.0",
      currentVersion: "0.19.7",
      downloadUrl: "https://github.com/release/v0.20.0",
      releaseNotes: "notes",
    });
  });

  it("returns null when already up to date", async () => {
    h.handler = () => ({
      statusCode: 200,
      body: JSON.stringify({ tag_name: "v0.19.7", html_url: "x" }),
    });
    expect(await checkForUpdate("0.19.7")).toBeNull();
  });

  it("returns null when the latest release is older", async () => {
    h.handler = () => ({
      statusCode: 200,
      body: JSON.stringify({ tag_name: "v0.19.0", html_url: "x" }),
    });
    expect(await checkForUpdate("0.19.7")).toBeNull();
  });

  it("returns null on non-200 status", async () => {
    h.handler = () => ({ statusCode: 404, body: "{}" });
    expect(await checkForUpdate("0.19.7")).toBeNull();
  });

  it("returns null on network error", async () => {
    h.handler = () => new Error("ECONNREFUSED");
    expect(await checkForUpdate("0.19.7")).toBeNull();
  });

  it("returns null for an invalid current version", async () => {
    expect(await checkForUpdate("not-a-version")).toBeNull();
    expect(h.requestedUrls).toEqual([]);
  });
});

describe("checkForUpdate via CodeChat download feed", () => {
  const SERVER = "https://codechat.example.com";
  // The test host is macOS, so the feed is the electron-builder mac metadata.
  const FEED_URL = `${SERVER}/api/downloads/desktop/mac/latest-mac.yml`;

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
        return {
          statusCode: 200,
          body: JSON.stringify({ tag_name: "v0.20.0", html_url: "gh" }),
        };
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
