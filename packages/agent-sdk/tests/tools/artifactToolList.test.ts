import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { ARTIFACT_TOOL_NAME } from "../../src/constants/tools.js";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
    getSSOToken: vi.fn(),
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

vi.mock("../../src/utils/toolResultStorage.js", () => ({
  persistToolResult: vi.fn(),
  persistToolResultBuffer: vi.fn(),
  buildPersistedOutputMessage: vi.fn(),
  generatePreview: vi.fn(),
}));

import { authService } from "../../src/services/authService.js";
import { artifactTool } from "../../src/tools/artifactTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { clearArtifactSession } from "../../src/services/artifactSession.js";

const SESSION_ID = "test-session";
const SERVER_URL = "https://server.test";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

/** Stub global fetch with a URL-routing mock. */
function stubFetchRoutes(
  routes: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: () => Partial<Response>;
  }>,
): Mock {
  const impl = vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(url, init));
    if (!route) {
      throw new Error(`No mock route for ${url}`);
    }
    return Promise.resolve(route.respond());
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: SESSION_ID,
    permissionMode: "default",
    ...overrides,
  } as ToolContext;
}

function frame(overrides: Record<string, unknown> = {}) {
  return {
    slug: "abc",
    title: "Design notes",
    rel: "mine",
    updatedAt: "2026-09-29T10:00:00Z",
    favicon: "📄",
    ...overrides,
  };
}

/** Stub the frames endpoint with the given rows. */
function stubFrames(rows: unknown[], status = 200): Mock {
  return stubFetchRoutes([
    {
      match: (url) => url.includes("/api/frame/frames"),
      respond: () =>
        status === 200
          ? jsonResponse(200, { frames: rows })
          : jsonResponse(status, { error: "boom" }),
    },
  ]);
}

describe("artifactTool list action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearArtifactSession(SESSION_ID);
    (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
    (authService.getSSOToken as Mock).mockReturnValue("token123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearArtifactSession(SESSION_ID);
  });

  describe("config", () => {
    it("declares all eight actions", () => {
      const properties = artifactTool.config.function.parameters
        ?.properties as Record<string, { enum?: string[] }>;
      expect(properties.action.enum).toEqual([
        "publish",
        "list",
        "read",
        "upload_asset",
        "list_assets",
        "read_asset",
        "delete_asset",
        "copy_from",
      ]);
    });

    it("formats a compact row for every action", () => {
      const context = makeContext();
      const url = "https://server.test/code/artifact/abc";
      const compact = (params: Record<string, unknown>) =>
        artifactTool.formatCompactParams!(params, context);

      expect(compact({ action: "list", scope: "all" })).toBe("list all");
      expect(compact({ action: "list" })).toBe("list mine");
      expect(compact({ action: "read", url })).toBe(`read ${url}`);
      expect(compact({ action: "upload_asset", file_path: "a.png", url })).toBe(
        "upload a.png",
      );
      expect(compact({ action: "list_assets", url })).toBe(
        `list assets ${url}`,
      );
      expect(compact({ action: "read_asset", url, asset_id: "id1" })).toBe(
        `read asset id1 of ${url}`,
      );
      expect(compact({ action: "delete_asset", url, asset_id: "id1" })).toBe(
        `delete asset id1 of ${url}`,
      );
      expect(
        compact({
          action: "copy_from",
          url,
          from: "src",
          asset_ids: ["a", "b"],
        }),
      ).toBe(`copy 2 asset(s) src → ${url}`);
      expect(compact({ file_path: "a.md", url })).toBe(`a.md → ${url}`);
    });
  });

  describe("scoping", () => {
    it("defaults to mine and never sends scope to the server", async () => {
      const fetchMock = stubFrames([
        frame({ slug: "mine1", rel: "mine" }),
        frame({ slug: "other1", rel: "shared", title: "Shared page" }),
      ]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("scope: mine");
      expect(result.content).toContain("(mine)");
      expect(result.content).toContain(`${SERVER_URL}/code/artifact/mine1`);
      expect(result.content).not.toContain("Shared page");
      expect(result.content).not.toContain("(shared)");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/frames?limit=200`);
      expect(init.method).toBe("GET");
      expect(url).not.toContain("scope");
    });

    it("keeps only shared rows for scope: shared", async () => {
      stubFrames([
        frame({ slug: "mine1", rel: "mine" }),
        frame({ slug: "other1", rel: "shared", title: "Shared page" }),
      ]);

      const result = await artifactTool.execute(
        { action: "list", scope: "shared" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Shared page");
      expect(result.content).not.toContain("mine1");
      expect(result.content).toContain("(shared)");
    });

    it("groups both relations for scope: all", async () => {
      stubFrames([
        frame({ slug: "mine1", rel: "mine" }),
        frame({ slug: "other1", rel: "shared", title: "Shared page" }),
      ]);

      const result = await artifactTool.execute(
        { action: "list", scope: "all" },
        makeContext(),
      );

      expect(result.content).toContain("(mine)");
      expect(result.content).toContain("(shared)");
      expect(result.content).toContain("mine1");
      expect(result.content).toContain("other1");
    });

    it("rejects an unknown scope without touching the network", async () => {
      const fetchMock = stubFetchRoutes([]);

      const result = await artifactTool.execute(
        { action: "list", scope: "everyone" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("scope must be one of mine, shared, all");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("limit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      frame({ slug: `s${i}`, title: `Doc ${i}` }),
    );

    it("caps the listing at the default 25 and says it is truncated", async () => {
      stubFrames(many);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.content).toContain("25 listed");
      expect(result.content).toContain("s24");
      expect(result.content).not.toContain("s25");
      expect(result.content).toContain('raise "limit" (max 50)');
    });

    it("honours an explicit limit", async () => {
      stubFrames(many);

      const result = await artifactTool.execute(
        { action: "list", limit: 10 },
        makeContext(),
      );

      expect(result.content).toContain("10 listed");
      expect(result.content).toContain("s9");
      expect(result.content).not.toContain("s10");
    });

    it("rejects a limit above the maximum instead of silently truncating", async () => {
      const fetchMock = stubFetchRoutes([]);

      const result = await artifactTool.execute(
        { action: "list", limit: 51 },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("limit must be at most 50 (got 51)");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a non-positive or non-numeric limit", async () => {
      for (const limit of [0, -3, 1.5, "10"]) {
        const result = await artifactTool.execute(
          { action: "list", limit },
          makeContext(),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("limit must be a positive integer");
      }
    });

    it("flags truncation when the server page was full", async () => {
      const fullPage = Array.from({ length: 200 }, (_, i) =>
        frame({ slug: `s${i}`, title: `Doc ${i}` }),
      );
      stubFrames(fullPage);

      const result = await artifactTool.execute(
        { action: "list", limit: 50 },
        makeContext(),
      );

      expect(result.content).toContain("50 listed");
      expect(result.content).toContain('raise "limit" (max 50)');
    });
  });

  describe("rendering", () => {
    it("shows title, URL, updatedAt and favicon", async () => {
      stubFrames([
        frame({
          slug: "abc",
          title: "Design notes",
          favicon: "🎨",
          updatedAt: "2026-09-29T10:00:00Z",
        }),
      ]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.content).toContain(
        `- 🎨 Design notes — ${SERVER_URL}/code/artifact/abc (updated 2026-09-29T10:00:00Z)`,
      );
      expect(result.shortResult).toBe("Listed 1 artifact (scope: mine)");
    });

    it("falls back to Untitled artifact and hides a shared row's favicon", async () => {
      stubFrames([
        frame({ slug: "noTitle", title: undefined }),
        frame({ slug: "shared1", rel: "shared", favicon: "🎨" }),
      ]);

      const result = await artifactTool.execute(
        { action: "list", scope: "all" },
        makeContext(),
      );

      expect(result.content).toContain("Untitled artifact");
      expect(result.content).toContain(`${SERVER_URL}/code/artifact/shared1`);
      expect(result.content).not.toContain("🎨");
    });

    it("collapses control characters in a title", async () => {
      stubFrames([frame({ title: "line\none\ttwo" })]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.content).toContain("line one two");
    });

    it("reports an empty result as a success", async () => {
      stubFrames([]);

      const result = await artifactTool.execute(
        { action: "list", scope: "shared" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("0 listed");
      expect(result.content).toContain("No artifacts matched.");
    });
  });

  describe("malformed rows", () => {
    it("skips soft-deleted and unknown-rel rows instead of failing", async () => {
      stubFrames([
        frame({ slug: "gone", softDeleted: true }),
        frame({ slug: "weird", rel: "org" }),
        frame({ slug: "ok" }),
      ]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("1 listed");
      expect(result.content).toContain("ok");
      expect(result.content).not.toContain("gone");
      expect(result.content).not.toContain("weird");
    });

    it("fails when every row is unreadable", async () => {
      stubFrames([{ nope: 1 }, "junk", { slug: "x", rel: "reader" }]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("response rows were unreadable");
    });

    it("fails when the reply has no frames array", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => jsonResponse(200, { rows: [] }) },
      ]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("malformed response: no frames array");
    });
  });

  describe("failures", () => {
    it("asks the user to log in when there is no token", async () => {
      (authService.getSSOToken as Mock).mockReturnValue(undefined);
      const fetchMock = stubFetchRoutes([]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not authenticated");
      expect(result.error).toContain("/login");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("surfaces an auth failure from the server", async () => {
      stubFrames([], 401);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("authentication failed (HTTP 401)");
    });

    it("retries a 5xx once before reporting it", async () => {
      const fetchMock = stubFrames([], 503);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 503");
    });

    it("retries a network failure once, then reports it", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
      vi.stubGlobal("fetch", fetchMock);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(false);
      expect(result.error).toContain("failed to reach the server");
      expect(result.error).toContain("ENOTFOUND");
    });

    it("rejects an unknown action", async () => {
      const fetchMock = stubFetchRoutes([]);

      const result = await artifactTool.execute(
        { action: "watch" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        `${ARTIFACT_TOOL_NAME}: unknown action "watch"`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
