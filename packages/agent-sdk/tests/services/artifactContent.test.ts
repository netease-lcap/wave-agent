import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

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

import { authService } from "../../src/services/authService.js";
import { persistToolResult } from "../../src/utils/toolResultStorage.js";
import {
  ARTIFACT_PREVIEW_BYTES,
  extractArtifactSlug,
  fetchFrameMeta,
  readArtifactContent,
  htmlToMarkdown,
  isLargeArtifactContent,
  persistArtifactContent,
} from "../../src/services/artifactContent.js";

const SERVER_URL = "https://server.test";
const CONTENT_URL = "/api/frame/abc/content";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Nope",
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

/** Stub global fetch with a URL-routing mock. */
function stubFetchRoutes(
  routes: Array<{
    match: (url: string) => boolean;
    respond: () => Partial<Response>;
  }>,
): Mock {
  const impl = vi.fn((url: string) => {
    const route = routes.find((r) => r.match(url));
    if (!route) {
      throw new Error(`No mock route for ${url}`);
    }
    return Promise.resolve(route.respond());
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

describe("artifactContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("extractArtifactSlug", () => {
    it("should extract the slug from an artifact URL", () => {
      expect(
        extractArtifactSlug("https://server.test/code/artifact/abc123"),
      ).toBe("abc123");
      expect(
        extractArtifactSlug("https://server.test/code/artifact/abc123/"),
      ).toBe("abc123");
    });

    it("should decode a percent-encoded slug", () => {
      expect(
        extractArtifactSlug("https://server.test/code/artifact/a%2Db"),
      ).toBe("a-b");
    });

    it("should return null for non-artifact and malformed URLs", () => {
      expect(
        extractArtifactSlug("https://server.test/code/artifact/abc/extra"),
      ).toBeNull();
      expect(extractArtifactSlug("https://server.test/docs/page")).toBeNull();
      expect(extractArtifactSlug("not a url")).toBeNull();
    });
  });

  describe("fetchFrameMeta", () => {
    it("should probe via=model_read and return the metadata", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: () => true,
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v2",
              contentUrl: CONTENT_URL,
            }),
        },
      ]);

      const result = await fetchFrameMeta("abc");

      expect(result).toEqual({
        kind: "ok",
        meta: { slug: "abc", version: "v2", contentUrl: CONTENT_URL },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/api/frame/abc?via=model_read`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should report a 404 with its status", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => jsonResponse(404, {}) },
      ]);
      expect(await fetchFrameMeta("abc")).toEqual({
        kind: "error",
        status: 404,
        error: expect.stringContaining("404"),
      });
    });

    it("should report network failures", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      );
      const result = await fetchFrameMeta("abc");
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error).toContain("ECONNREFUSED");
      }
    });
  });

  describe("readArtifactContent", () => {
    it("should return raw HTML and mark owner artifacts", async () => {
      const html = "<html><body><style>.a{color:red}</style></body></html>";
      stubFetchRoutes([
        {
          match: (url) => url.includes("?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v2",
              perm: { mode: "owner", role: "owner" },
              contentUrl: CONTENT_URL,
            }),
        },
        {
          match: (url) => url === `${SERVER_URL}${CONTENT_URL}`,
          respond: () => textResponse(200, html),
        },
      ]);

      const result = await readArtifactContent("abc", {
        url: `${SERVER_URL}/code/artifact/abc`,
      });

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.artifact).toEqual({
          slug: "abc",
          version: "v2",
          ownership: "owner",
          html,
          bytes: new TextEncoder().encode(html).length,
        });
      }
    });

    it("should mark shared artifacts as reader-owned", async () => {
      stubFetchRoutes([
        {
          match: (url) => url.includes("?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v1",
              perm: { mode: "users", role: "reader" },
              contentUrl: CONTENT_URL,
            }),
        },
        {
          match: () => true,
          respond: () => textResponse(200, "<html></html>"),
        },
      ]);

      const result = await readArtifactContent("abc");

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.artifact.ownership).toBe("reader");
      }
    });

    it("should treat unknown ownership as reader", async () => {
      stubFetchRoutes([
        {
          match: (url) => url.includes("?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v1",
              contentUrl: CONTENT_URL,
            }),
        },
        {
          match: () => true,
          respond: () => textResponse(200, "<html></html>"),
        },
      ]);

      const result = await readArtifactContent("abc");

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.artifact.ownership).toBe("reader");
      }
    });

    it("should report a deleted artifact", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => jsonResponse(404, {}) },
      ]);

      const result = await readArtifactContent("abc", {
        url: `${SERVER_URL}/code/artifact/abc`,
      });

      expect(result).toEqual({
        kind: "error",
        status: 404,
        error: `Artifact not found: ${SERVER_URL}/code/artifact/abc (it may have been deleted)`,
      });
    });

    it("should distinguish a forbidden artifact from a missing one", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => jsonResponse(403, {}) },
      ]);

      const result = await readArtifactContent("abc", {
        url: `${SERVER_URL}/code/artifact/abc`,
      });

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.status).toBe(403);
        expect(result.error).toContain("do not have permission");
      }
    });

    it("should report metadata without a contentUrl", async () => {
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(200, { slug: "abc", version: "v1" }),
        },
      ]);

      const result = await readArtifactContent("abc");

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error).toContain("contentUrl");
      }
    });

    it("should report a failed content fetch", async () => {
      stubFetchRoutes([
        {
          match: (url) => url.includes("?via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: "abc",
              version: "v1",
              contentUrl: CONTENT_URL,
            }),
        },
        { match: () => true, respond: () => textResponse(500, "") },
      ]);

      const result = await readArtifactContent("abc");

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error).toContain("500");
      }
    });
  });

  describe("content helpers", () => {
    it("should convert HTML to markdown", () => {
      const markdown = htmlToMarkdown(
        "<html><body><h1>Title</h1><p>Body</p></body></html>",
      );
      expect(markdown).toContain("Title");
      expect(markdown).not.toContain("<h1>");
    });

    it("should treat content above the preview budget as large", () => {
      expect(isLargeArtifactContent("small")).toBe(false);
      expect(
        isLargeArtifactContent("x".repeat(ARTIFACT_PREVIEW_BYTES + 1)),
      ).toBe(true);
    });

    it("should persist large content and skip small content", () => {
      expect(persistArtifactContent("small")).toBeNull();
      expect(persistToolResult).not.toHaveBeenCalled();

      const large = "x".repeat(ARTIFACT_PREVIEW_BYTES + 1);
      const message = persistArtifactContent(large);

      expect(persistToolResult).toHaveBeenCalledWith(large, "artifact");
      expect(message).toContain("<persisted-output>");
      expect(message).toContain("/tmp/wave-tool-results/artifact_1.txt");
    });

    it("should return null when persisting fails", () => {
      (persistToolResult as Mock).mockReturnValue(undefined);
      expect(
        persistArtifactContent("x".repeat(ARTIFACT_PREVIEW_BYTES + 1)),
      ).toBeNull();
    });
  });
});
