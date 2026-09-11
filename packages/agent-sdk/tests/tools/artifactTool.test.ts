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

vi.mock("../../src/utils/toolResultStorage.js", () => ({
  persistToolResult: vi
    .fn()
    .mockReturnValue("/tmp/wave-tool-results/artifact_1.txt"),
  buildPersistedOutputMessage: vi.fn(
    (len: number, filePath: string, preview: string) =>
      `<persisted-output>${len} chars -> ${filePath} preview: ${preview}</persisted-output>`,
  ),
  generatePreview: vi.fn((s: string) => s.substring(0, 100)),
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
const ARTIFACT_URL = "https://server.test/code/artifact/abc";
const CONTENT_URL = "/api/frame/abc/content";
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

function textResponse(status: number, body: string): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Nope",
    text: vi.fn().mockResolvedValue(body),
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
    it("should declare name, non-concurrent execution and no statically required parameter", () => {
      expect(artifactTool.name).toBe(ARTIFACT_TOOL_NAME);
      expect(artifactTool.isConcurrencySafe).toBe(false);
      const fn = artifactTool.config.function;
      expect(fn.name).toBe(ARTIFACT_TOOL_NAME);
      // publish needs file_path, read needs url — both validated at runtime.
      expect(fn.parameters?.required).toEqual([]);
      const properties = fn.parameters?.properties as Record<
        string,
        { enum?: string[] }
      >;
      expect(properties.action.enum).toEqual(["publish", "read"]);
      expect(properties.prompt).toBeDefined();
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

    it("should format compact params for reads", () => {
      expect(
        artifactTool.formatCompactParams!(
          { action: "read", url: "https://server.test/code/artifact/abc" },
          makeContext(),
        ),
      ).toBe("Artifact(read https://server.test/code/artifact/abc)");
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

    it("should use the file basename as the label when none is given (markdown)", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/guide",
              slug: "guide",
              path: "docs/guide.md",
              title: "guide",
              version: "v1",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { file_path: "docs/guide.md" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      // Server title order is <title> > label > "Untitled artifact"; supplying the
      // basename keeps the published page from ending up untitled.
      expect(body.label).toBe("guide");
      expect(body.content).toContain("<title>guide</title>");
    });

    it("should use the file basename as the label when none is given (html)", async () => {
      (readFileSync as Mock).mockReturnValue(HTML_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: "https://server.test/code/artifact/html1",
              slug: "html1",
              path: "pages/landing.html",
              title: "landing",
              version: "v1",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { file_path: "pages/landing.html" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.label).toBe("landing");
      // The page's own <title> still wins server-side, so content stays untouched.
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

  describe("read action", () => {
    const OWNER_HTML =
      "<!DOCTYPE html><html><head><style>.a{color:red}</style></head><body><h1>Hello</h1><script>run()</script></body></html>";

    function makeAiContext(overrides: Partial<ToolContext> = {}): ToolContext {
      return makeContext({
        aiManager: {
          getModelConfig: vi.fn().mockReturnValue({
            model: "gpt-4",
            fastModel: "gpt-3.5-turbo",
          }),
          getGatewayConfig: vi.fn().mockReturnValue({ apiKey: "k" }),
        } as unknown as ToolContext["aiManager"],
        aiService: {
          processWebContent: vi.fn().mockResolvedValue({
            content: "A summary of the shared page.",
          }),
        } as unknown as ToolContext["aiService"],
        ...overrides,
      });
    }

    /** Route the metadata probe + content fetch used by every read. */
    function stubArtifactRead(meta: unknown, html: string): Mock {
      return stubFetchRoutes([
        {
          match: (url) => url.includes("/api/frame/abc?via=model_read"),
          respond: () => jsonResponse(200, meta),
        },
        {
          match: (url) => url === `${SERVER_URL}${CONTENT_URL}`,
          respond: () => textResponse(200, html),
        },
      ]);
    }

    const OWNER_META = {
      slug: "abc",
      version: "v2",
      perm: { mode: "owner", role: "owner" },
      contentUrl: CONTENT_URL,
    };

    it("should require a url for reads", async () => {
      const result = await artifactTool.execute(
        { action: "read" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required parameter "url"');
    });

    it("should reject a url that is not an artifact page", async () => {
      const result = await artifactTool.execute(
        { action: "read", url: "https://server.test/docs/page" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("url must point to an artifact page");
    });

    it("should reject an unknown action", async () => {
      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('action must be "publish" or "read"');
    });

    it("should reject unauthenticated reads", async () => {
      (authService.getSSOToken as Mock).mockReturnValue(undefined);
      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeContext(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not authenticated. Run /login");
    });

    it("should return the raw HTML with the version for owned artifacts", async () => {
      stubArtifactRead(OWNER_META, OWNER_HTML);
      const context = makeAiContext();

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        context,
      );

      expect(result.success).toBe(true);
      // The raw source is handed back — no markdown conversion, no AI summary.
      expect(result.content).toContain("<!DOCTYPE html>");
      expect(result.content).toContain("<style>.a{color:red}</style>");
      expect(result.content).toContain("<script>run()</script>");
      expect(result.content).toContain("Version: v2");
      expect(context.aiService!.processWebContent).not.toHaveBeenCalled();
      expect(result.shortResult).toContain("Read artifact abc");
      // The observed version feeds the stale-version guard.
      expect(getRecordedVersion(SESSION_ID, "abc")).toBe("v2");
    });

    it("should persist large HTML instead of inlining it", async () => {
      const largeHtml = `<html><body><p>${"x".repeat(5000)}</p></body></html>`;
      stubArtifactRead({ ...OWNER_META }, largeHtml);

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeAiContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("<persisted-output>");
      expect(result.content).toContain("/tmp/wave-tool-results/artifact_1.txt");
      expect(result.content).toContain("Version: v2");
    });

    it("should record the read version so a republish is not flagged stale", async () => {
      recordVersion(SESSION_ID, "abc", "v1");
      stubArtifactRead(OWNER_META, OWNER_HTML);

      await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeAiContext(),
      );

      expect(getRecordedVersion(SESSION_ID, "abc")).toBe("v2");
    });

    it("should summarize artifacts shared by someone else after confirmation", async () => {
      stubArtifactRead(
        {
          slug: "abc",
          version: "v4",
          perm: { mode: "users", role: "reader" },
          contentUrl: CONTENT_URL,
        },
        "<html><body><h1>Shared Title</h1></body></html>",
      );
      const { manager, permissionContext } = makePermissionManager("allow");
      const context = makeAiContext({
        permissionManager:
          manager as unknown as ToolContext["permissionManager"],
      });

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL, prompt: "What is the layout?" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("A summary of the shared page.");
      expect(manager.createContext).toHaveBeenCalledWith(
        ARTIFACT_TOOL_NAME,
        "default",
        undefined,
        expect.objectContaining({ action: "read", url: ARTIFACT_URL }),
        undefined,
      );
      expect(permissionContext.hidePersistentOption).toBe(true);
      // The fast model gets the text, never the raw third-party HTML.
      expect(context.aiService!.processWebContent).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Shared Title"),
          prompt: "What is the layout?",
        }),
      );
    });

    it("should not re-confirm the same shared artifact within the session", async () => {
      stubArtifactRead(
        {
          slug: "abc",
          version: "v4",
          perm: { mode: "users" },
          contentUrl: CONTENT_URL,
        },
        "<html><body><p>Shared</p></body></html>",
      );
      const { manager } = makePermissionManager("allow");
      const context = makeAiContext({
        permissionManager:
          manager as unknown as ToolContext["permissionManager"],
      });

      await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        context,
      );
      await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        context,
      );

      expect(manager.createContext).toHaveBeenCalledTimes(1);
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);
    });

    it("should report a denied read confirmation", async () => {
      stubArtifactRead(
        {
          slug: "abc",
          version: "v4",
          perm: { mode: "users" },
          contentUrl: CONTENT_URL,
        },
        "<html><body><p>Shared</p></body></html>",
      );
      const { manager } = makePermissionManager("deny");

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeAiContext({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "operation denied by user, reason: No way",
      );
    });

    it("should not confirm reading your own artifact", async () => {
      stubArtifactRead(OWNER_META, OWNER_HTML);
      const { manager } = makePermissionManager("allow");

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeAiContext({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(true);
      expect(manager.createContext).not.toHaveBeenCalled();
    });

    it("should report a deleted artifact", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => jsonResponse(404, {}) },
      ]);

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeAiContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Artifact not found: ${ARTIFACT_URL}`);
    });

    it("should distinguish a forbidden artifact from a missing one", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => jsonResponse(403, {}) },
      ]);

      const result = await artifactTool.execute(
        { action: "read", url: ARTIFACT_URL },
        makeAiContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("do not have permission");
    });

    it("should publish when the action is explicitly publish", async () => {
      (readFileSync as Mock).mockReturnValue(MD_CONTENT);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.endsWith("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: ARTIFACT_URL,
              slug: "abc",
              version: "v1",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "publish", file_path: "doc.md" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${SERVER_URL}/api/frame/deploy/direct`,
      );
    });
  });
});
