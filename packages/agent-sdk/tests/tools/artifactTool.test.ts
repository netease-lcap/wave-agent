import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "fs";
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

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { authService } from "../../src/services/authService.js";
import { artifactTool } from "../../src/tools/artifactTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import {
  clearArtifactSession,
  getArtifactByFilePath,
  getRecordedVersion,
  recordArtifact,
  recordVersion,
} from "../../src/services/artifactSession.js";

const SESSION_ID = "test-session";
const SERVER_URL = "https://server.test";
const MD_CONTENT = "# Hello World\n\nSome **bold** text.";
const HTML_CONTENT =
  "<!DOCTYPE html><html><body><h1>Plain HTML</h1></body></html>";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 201 ? "Created" : status === 409 ? "Conflict" : "OK",
    json: vi.fn().mockResolvedValue(body),
  };
}

/**
 * Stub global fetch with a URL-routing mock. Each route's `match` inspects the
 * request URL (and optionally init), returning its response for the first match.
 */
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

function makePermissionManager(behavior: "allow" | "deny" = "allow") {
  const permissionContext: Record<string, unknown> = {};
  return {
    permissionContext,
    manager: {
      createContext: vi.fn().mockReturnValue(permissionContext),
      checkPermission: vi
        .fn()
        .mockResolvedValue(
          behavior === "allow"
            ? { behavior: "allow" as const }
            : { behavior: "deny" as const, message: "No way" },
        ),
    },
  };
}

describe("artifactTool", () => {
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
    it("should declare name, non-concurrent execution and required file_path", () => {
      expect(artifactTool.name).toBe(ARTIFACT_TOOL_NAME);
      expect(artifactTool.isConcurrencySafe).toBe(false);
      const fn = artifactTool.config.function;
      expect(fn.name).toBe(ARTIFACT_TOOL_NAME);
      expect(fn.parameters?.required).toEqual(["file_path"]);
    });

    it("should format compact params as file → url", () => {
      expect(
        artifactTool.formatCompactParams!(
          {
            file_path: "docs/guide.md",
            url: "https://server.test/code/artifact/abc",
          },
          makeContext(),
        ),
      ).toBe("Artifact(docs/guide.md → https://server.test/code/artifact/abc)");
    });
  });

  describe("argument validation", () => {
    it("should reject a missing file_path", async () => {
      const result = await artifactTool.execute({}, makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required parameter "file_path"');
    });

    it("should reject a non-emoji favicon", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const result = await artifactTool.execute(
        { file_path: "doc.md", favicon: "AB" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("favicon must be 1-2 emoji characters");
    });

    it("should reject a multi-codepoint emoji sequence (family counts as 3)", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const result = await artifactTool.execute(
        { file_path: "doc.md", favicon: "👨‍👩‍👧" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("favicon must be 1-2 emoji characters");
    });

    it("should accept a 2-emoji favicon including variation selectors", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/abc",
              slug: "abc",
              path: "doc.md",
              title: "Doc",
              version: "v1",
            }),
        },
      ]);
      const result = await artifactTool.execute(
        { file_path: "doc.md", favicon: "📄✨️" },
        makeContext(),
      );
      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.favicon).toBe("📄✨️");
    });

    it("should reject a label longer than 60 characters", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const result = await artifactTool.execute(
        { file_path: "doc.md", label: "x".repeat(61) },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("label must be at most 60 characters");
    });

    it("should reject a url that is not an artifact URL", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const result = await artifactTool.execute(
        { file_path: "doc.md", url: "https://server.test/other/page" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("url must point to an artifact page");
    });

    it("should reject non-html/md files", async () => {
      const result = await artifactTool.execute(
        { file_path: "notes.txt" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "only .html and .md files can be published",
      );
    });

    it("should reject extension-less files", async () => {
      const result = await artifactTool.execute(
        { file_path: "README" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('(got "no extension")');
    });

    it("should report an unreadable file", async () => {
      (readFileSync as Mock).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("file not found or unreadable: doc.md");
    });

    it("should reject content over the 16MB server limit", async () => {
      (readFileSync as Mock).mockReturnValue("a".repeat(17 * 1024 * 1024));
      const result = await artifactTool.execute(
        { file_path: "big.html" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("16MB server limit");
    });

    it("should reject unauthenticated publishes", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      (authService.getSSOToken as Mock).mockReturnValue(undefined);
      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not authenticated. Run /login");
    });
  });

  describe("fresh publish", () => {
    it("should render markdown to HTML and POST to deploy/direct", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/abc",
              slug: "abc",
              path: "doc.md",
              title: "Doc",
              version: "v1",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { file_path: "doc.md", label: "My Doc" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        "Artifact published: https://server.test/code/artifact/abc",
      );
      expect(result.content).toContain("Path: doc.md");
      expect(result.content).toContain("Title: Doc");
      expect(result.content).toContain("Version: v1");
      expect(result.shortResult).toBe(
        "Published doc.md → https://server.test/code/artifact/abc",
      );

      const [deployUrl, init] = fetchMock.mock.calls[0];
      expect(deployUrl).toBe(`${SERVER_URL}/api/frame/deploy/direct`);
      expect(init!.method).toBe("POST");
      const body = JSON.parse(init!.body as string);
      expect(body.content).toContain("<h1>Hello World</h1>");
      expect(body.content).toContain("<!DOCTYPE html>");
      expect(body.content).toContain("<title>My Doc</title>");
      expect(body.favicon).toBe("📄");
      expect(body.label).toBe("My Doc");
      expect(body.url).toBeUndefined();
      expect(body.baseVersion).toBeUndefined();
      expect(body.force).toBeUndefined();

      // Same-session state recorded for auto-allow on republish.
      expect(getArtifactByFilePath(SESSION_ID, "doc.md")).toEqual({
        url: "https://server.test/code/artifact/abc",
        slug: "abc",
        version: "v1",
      });
      expect(getRecordedVersion(SESSION_ID, "abc")).toBe("v1");
    });

    it("should pass .html files through without rendering", async () => {
      (readFileSync as Mock).mockReturnValue(HTML_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/html1",
              slug: "html1",
              version: "v1",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { file_path: "page.html" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.content).toBe(HTML_CONTENT);
    });

    it("should ask for permission on the first publish and deny correctly", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const { manager, permissionContext } = makePermissionManager("deny");

      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "operation denied by user, reason: No way",
      );
      expect(manager.createContext).toHaveBeenCalledWith(
        ARTIFACT_TOOL_NAME,
        "default",
        undefined,
        expect.objectContaining({ file_path: "doc.md" }),
        undefined,
      );
      expect(permissionContext.warning).toBeUndefined();
      expect(permissionContext.hidePersistentOption).toBeUndefined();
    });

    it("should auto-allow republishing a file already published this session", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      recordArtifact(SESSION_ID, "doc.md", {
        url: "https://server.test/code/artifact/abc",
        slug: "abc",
        version: "v1",
      });
      const { manager } = makePermissionManager();
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/abc",
              slug: "abc",
              version: "v2",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(true);
      expect(manager.createContext).not.toHaveBeenCalled();
      expect(manager.checkPermission).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should surface 409 conflicts with the live version and record it", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      stubFetchRoutes([
        {
          match: (url) => url.includes("/api/frame/abc?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v4",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () => jsonResponse(409, { live: "v5", message: "conflict" }),
        },
      ]);

      const result = await artifactTool.execute(
        {
          file_path: "doc.md",
          url: "https://server.test/code/artifact/abc",
        },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("conflict detected");
      expect(result.error).toContain("(live version: v5)");
      expect(result.error).toContain('Pass "force": true');
      // The observed live version is recorded so a follow-up republish knows it.
      expect(getRecordedVersion(SESSION_ID, "abc")).toBe("v5");
    });

    it("should surface 413 as a size error", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(413, {}),
        },
      ]);
      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("too large");
    });

    it("should surface 400 with the server message", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(400, { message: "bad content" }),
        },
      ]);
      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("server rejected the publish");
      expect(result.error).toContain("bad content");
    });

    it("should surface 401/403 auth failures", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(401, {}),
        },
      ]);
      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("authentication failed (HTTP 401)");
    });

    it("should report network failures", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );
      const result = await artifactTool.execute(
        { file_path: "doc.md" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "failed to reach the server: ECONNREFUSED",
      );
    });
  });

  describe("redeploy (with url)", () => {
    it("should probe current metadata and pass baseVersion", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("/api/frame/abc?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v2",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/abc",
              slug: "abc",
              version: "v3",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        {
          file_path: "doc.md",
          url: "https://server.test/code/artifact/abc",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const body = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
      expect(body.url).toBe("https://server.test/code/artifact/abc");
      expect(body.baseVersion).toBe("v2");
      expect(getRecordedVersion(SESSION_ID, "abc")).toBe("v3");
    });

    it("should fail when the artifact no longer exists", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(404, {}),
        },
      ]);
      const result = await artifactTool.execute(
        {
          file_path: "doc.md",
          url: "https://server.test/code/artifact/abc",
        },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "artifact not found at https://server.test/code/artifact/abc",
      );
    });

    it("should block stale redeploys unless force is set", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      recordVersion(SESSION_ID, "abc", "v1");
      stubFetchRoutes([
        {
          match: (url) => url.includes("/api/frame/abc?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v2",
              perm: { mode: "owner" },
            }),
        },
      ]);
      const result = await artifactTool.execute(
        {
          file_path: "doc.md",
          url: "https://server.test/code/artifact/abc",
        },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("stale version");
      expect(result.error).toContain('Pass "force": true');
    });

    it("should redeploy with force when the version is stale", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      recordVersion(SESSION_ID, "abc", "v1");
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("/api/frame/abc?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v2",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/abc",
              slug: "abc",
              version: "v3",
            }),
        },
      ]);
      const result = await artifactTool.execute(
        {
          file_path: "doc.md",
          url: "https://server.test/code/artifact/abc",
          force: true,
        },
        makeContext(),
      );
      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
      expect(body.force).toBe(true);
      expect(body.baseVersion).toBe("v2");
    });

    it("should warn + force confirmation on shared-live redeploys", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      // Version matches what this session last saw so the stale guard passes
      // and the shared-live confirmation is what blocks the redeploy.
      recordVersion(SESSION_ID, "abc", "v2");
      const { manager, permissionContext } = makePermissionManager("allow");
      stubFetchRoutes([
        {
          match: (url) => url.includes("/api/frame/abc?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v2",
              perm: { mode: "users" },
            }),
        },
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/abc",
              slug: "abc",
              version: "v3",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        {
          file_path: "doc.md",
          url: "https://server.test/code/artifact/abc",
        },
        makeContext({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(true);
      expect(manager.createContext).toHaveBeenCalledTimes(1);
      expect(permissionContext.warning).toContain("shared-live");
      expect(permissionContext.hidePersistentOption).toBe(true);
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);
    });
  });
});
