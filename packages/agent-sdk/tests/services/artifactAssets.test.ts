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
  persistToolResult: vi.fn(),
  persistToolResultBuffer: vi.fn(),
  buildPersistedOutputMessage: vi.fn(),
  generatePreview: vi.fn(),
}));

import { authService } from "../../src/services/authService.js";
import {
  ASSET_MAX_BYTES,
  ASSET_PAGE_SIZE,
  ASSET_SVG_MAX_BYTES,
  assetContentTypeFor,
  assetFileExtension,
  assetSizeLimitFor,
  copyAssets,
  deleteAsset,
  isAssetId,
  isTextContentType,
  listAssets,
  normalizeAssetId,
  readAsset,
  uploadAsset,
} from "../../src/services/artifactAssets.js";

const SERVER_URL = "https://server.test";
const SLUG = "abc";
const ASSET_ID = "0123456789abcdef0123456789abcdef";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Nope",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function textResponse(
  status: number,
  body: string,
  statusText = "Nope",
): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(body),
  };
}

function blobResponse(
  status: number,
  body: Buffer,
  contentType: string,
): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Nope",
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(
        body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as unknown as ArrayBuffer,
      ),
    text: vi.fn().mockResolvedValue(body.toString("utf8")),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    } as unknown as Headers,
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

function assetRecord(overrides: Record<string, unknown> = {}) {
  return {
    opaque_id: ASSET_ID,
    url: `_blob/${ASSET_ID}`,
    content_type: "image/png",
    size_bytes: 2048,
    sha256: "abc123",
    created_at: "2026-09-29T00:00:00Z",
    ...overrides,
  };
}

describe("artifactAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
    (authService.getSSOToken as Mock).mockReturnValue("token123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("local helpers", () => {
    it("maps extensions to MIME types case-insensitively", () => {
      expect(assetContentTypeFor("logo.PNG")).toBe("image/png");
      expect(assetContentTypeFor("docs/report.md")).toBe("text/markdown");
      expect(assetContentTypeFor("src/main.mjs")).toBe("text/javascript");
      expect(assetContentTypeFor("notes.rtf")).toBeUndefined();
      expect(assetContentTypeFor("Makefile")).toBeUndefined();
    });

    it("uses the tighter ceiling for SVG", () => {
      expect(assetSizeLimitFor("image/svg+xml")).toBe(ASSET_SVG_MAX_BYTES);
      expect(assetSizeLimitFor("image/png")).toBe(ASSET_MAX_BYTES);
      expect(ASSET_SVG_MAX_BYTES).toBeLessThan(ASSET_MAX_BYTES);
    });

    it("derives a file extension from a content type", () => {
      expect(assetFileExtension("image/png")).toBe("png");
      expect(assetFileExtension("text/plain; charset=utf-8")).toBe("txt");
      expect(assetFileExtension("application/zip")).toBe("zip");
      expect(assetFileExtension("application/octet-stream")).toBe("bin");
      expect(assetFileExtension("weird/!bad!")).toBe("bin");
    });

    it("accepts a bare id, a _blob reference or a full URL", () => {
      expect(isAssetId(ASSET_ID)).toBe(true);
      expect(isAssetId(ASSET_ID.toUpperCase())).toBe(false);
      expect(isAssetId("short")).toBe(false);

      expect(normalizeAssetId(ASSET_ID)).toBe(ASSET_ID);
      expect(normalizeAssetId(`_blob/${ASSET_ID}`)).toBe(ASSET_ID);
      expect(normalizeAssetId(`/_blob/${ASSET_ID}`)).toBe(ASSET_ID);
      expect(
        normalizeAssetId(`https://server.test/_f/v1/_blob/${ASSET_ID}?x=1`),
      ).toBe(ASSET_ID);
      expect(normalizeAssetId("not-an-id")).toBeNull();
    });

    it("treats textual content types as inline-readable", () => {
      expect(isTextContentType("text/plain")).toBe(true);
      expect(isTextContentType("text/plain; charset=utf-8")).toBe(true);
      expect(isTextContentType("application/json")).toBe(true);
      expect(isTextContentType("image/svg+xml")).toBe(true);
      expect(isTextContentType("image/png")).toBe(false);
      expect(isTextContentType("font/woff2")).toBe(false);
    });
  });

  describe("uploadAsset", () => {
    it("posts raw bytes with the mapped content type", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("/agent-upload"),
          respond: () => jsonResponse(200, assetRecord()),
        },
      ]);

      const outcome = await uploadAsset(
        SLUG,
        Buffer.from("png-bytes"),
        "image/png",
      );

      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") return;
      expect(outcome.value.asset_id).toBe(ASSET_ID);
      expect(outcome.value.sha256).toBe("abc123");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/blob/${SLUG}/agent-upload`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "image/png",
      );
      expect(Buffer.from(init.body as Uint8Array).toString()).toBe("png-bytes");
    });

    it("reports an unreadable success reply as a maybe-succeeded upload", async () => {
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => textResponse(200, "not json"),
        },
      ]);

      const outcome = await uploadAsset(SLUG, Buffer.from("x"), "image/png");

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("probably succeeded");
      expect(outcome.error).toContain("retry at most once");
    });

    it("maps the server's auth and payload errors to actionable messages", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => textResponse(401, "") },
      ]);
      const unauthorized = await uploadAsset(
        SLUG,
        Buffer.from("x"),
        "image/png",
      );
      expect(unauthorized.kind === "error" && unauthorized.error).toContain(
        "/login",
      );
    });

    it("reports a transit failure as safe to retry", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      );

      const outcome = await uploadAsset(SLUG, Buffer.from("x"), "image/png");

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("in transit or timed out");
      expect(outcome.error).toContain("ECONNRESET");
    });
  });

  describe("error mapping", () => {
    const cases: Array<[number, string, string]> = [
      [401, "", "/login"],
      [403, "not a writer", "only the artifact's owner or a writer"],
      [403, '{"error":{"message":"role is read-only"}}', "role is read-only"],
      [404, '{"error":{"code":"asset_not_found"}}', "asset_not_found"],
      [409, "", "cannot take the delete right now"],
      [413, "", "too large"],
      [415, "invalid content type", "bare MIME type"],
      [429, "", "rate limited"],
      [503, "", "asset store is unavailable"],
      [400, "", "unexpected answer from the server"],
    ];

    it.each(cases)(
      "maps HTTP %i to a message containing %s",
      async (status, body, expected) => {
        stubFetchRoutes([
          {
            match: () => true,
            respond: () => textResponse(status, body, "Error"),
          },
        ]);

        const outcome = await deleteAsset(SLUG, ASSET_ID);

        expect(outcome.kind).toBe("error");
        if (outcome.kind !== "error") return;
        expect(outcome.error).toContain(expected);
      },
    );
  });

  describe("listAssets", () => {
    it("posts a fixed page size and parses usage", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("/agent-list"),
          respond: () =>
            jsonResponse(200, {
              assets: [assetRecord()],
              usage: {
                files: 1,
                bytes: 2048,
                max_files: 100,
                max_bytes: 100 * 1024 * 1024,
              },
            }),
        },
      ]);

      const outcome = await listAssets(SLUG, undefined);

      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") return;
      expect(outcome.value.assets).toHaveLength(1);
      expect(outcome.value.usage).toEqual({
        files: 1,
        bytes: 2048,
        max_files: 100,
        max_bytes: 100 * 1024 * 1024,
      });
      expect(outcome.value.next).toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/blob/${SLUG}/agent-list`);
      expect(JSON.parse(init.body as string)).toEqual({
        limit: ASSET_PAGE_SIZE,
      });
      expect(ASSET_PAGE_SIZE).toBe(50);
    });

    it("passes the cursor through and echoes the next one", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: () => true,
          respond: () =>
            jsonResponse(200, {
              assets: [],
              usage: { files: 0, bytes: 0, max_files: 10, max_bytes: 10 },
              next: "cursor-2",
            }),
        },
      ]);

      const outcome = await listAssets(SLUG, "cursor-1");

      expect(outcome.kind === "ok" && outcome.value.next).toBe("cursor-2");
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        limit: ASSET_PAGE_SIZE,
        after: "cursor-1",
      });
    });

    it("reports an unreadable listing reply", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => textResponse(200, '{"nope":1}') },
      ]);

      const outcome = await listAssets(SLUG, undefined);

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("listing reply was unreadable");
    });
  });

  describe("copyAssets", () => {
    it("returns copies in the requested order even when the reply reorders", async () => {
      const first = "a".repeat(32);
      const second = "b".repeat(32);
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("/agent-copy"),
          respond: () =>
            jsonResponse(200, {
              assets: [
                assetRecord({ opaque_id: "c".repeat(32), from_id: second }),
                assetRecord({ opaque_id: "d".repeat(32), from_id: first }),
              ],
            }),
        },
      ]);

      const outcome = await copyAssets(SLUG, "src", [first, second]);

      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") return;
      expect(outcome.value.map((c) => c.from_id)).toEqual([first, second]);
      expect(outcome.value.map((c) => c.asset_id)).toEqual([
        "d".repeat(32),
        "c".repeat(32),
      ]);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/blob/${SLUG}/agent-copy`);
      expect(JSON.parse(init.body as string)).toEqual({
        from: "src",
        ids: [first, second],
      });
    });

    it("drops ids the server did not confirm", async () => {
      const first = "a".repeat(32);
      const second = "b".repeat(32);
      stubFetchRoutes([
        {
          match: () => true,
          respond: () =>
            jsonResponse(200, {
              assets: [
                assetRecord({ opaque_id: "c".repeat(32), from_id: first }),
              ],
            }),
        },
      ]);

      const outcome = await copyAssets(SLUG, "src", [first, second]);

      expect(
        outcome.kind === "ok" && outcome.value.map((c) => c.from_id),
      ).toEqual([first]);
    });

    it("warns that a partial copy may have happened", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => textResponse(200, "boom") },
      ]);

      const outcome = await copyAssets(SLUG, "src", ["a".repeat(32)]);

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("some assets may have been copied");
    });
  });

  describe("deleteAsset", () => {
    it("posts to the per-asset delete route and reports the flag", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(200, { deleted: true }),
        },
      ]);

      const outcome = await deleteAsset(SLUG, ASSET_ID);

      expect(outcome.kind === "ok" && outcome.value.deleted).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${SERVER_URL}/api/frame/blob/${SLUG}/${ASSET_ID}/agent-delete`,
      );
      expect(init.method).toBe("POST");
    });

    it("treats an already-deleted asset as a success", async () => {
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(200, { deleted: false }),
        },
      ]);

      const outcome = await deleteAsset(SLUG, ASSET_ID);

      expect(outcome.kind === "ok" && outcome.value.deleted).toBe(false);
    });

    it("reports an unreadable delete reply as maybe-succeeded", async () => {
      stubFetchRoutes([
        { match: () => true, respond: () => textResponse(200, "ok!") },
      ]);

      const outcome = await deleteAsset(SLUG, ASSET_ID);

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("delete may have succeeded");
    });
  });

  describe("readAsset", () => {
    it("probes the artifact for an asset token, then reads the blob without a Bearer token", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: SLUG,
              version: "v7",
              assetToken: "tok-abc",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () =>
            blobResponse(200, Buffer.from("<svg/>"), "image/svg+xml"),
        },
      ]);

      const outcome = await readAsset(SLUG, ASSET_ID);

      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") return;
      expect(outcome.value.bytes.toString("utf8")).toBe("<svg/>");
      expect(outcome.value.contentType).toBe("image/svg+xml");
      expect(outcome.value.ownership).toBe("owner");

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${SERVER_URL}/api/frame/${SLUG}?via=model_read`,
      );
      const [blobUrl, blobInit] = fetchMock.mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(blobUrl).toBe(
        `${SERVER_URL}/_f/v7/_blob/${ASSET_ID}?__frame_t=tok-abc`,
      );
      expect(blobInit.headers).toBeUndefined();
    });

    it("reads the numeric version the server actually sends", async () => {
      const fetchMock = stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () =>
            jsonResponse(200, {
              slug: SLUG,
              version: 3,
              assetToken: "tok-abc",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () => blobResponse(200, Buffer.from("hi"), "text/plain"),
        },
      ]);

      const outcome = await readAsset(SLUG, ASSET_ID);

      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") return;
      expect(outcome.value.bytes.toString("utf8")).toBe("hi");
      expect(fetchMock.mock.calls[1][0]).toBe(
        `${SERVER_URL}/_f/3/_blob/${ASSET_ID}?__frame_t=tok-abc`,
      );
    });

    it("treats an artifact with no ownership information as someone else's", async () => {
      stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () =>
            jsonResponse(200, { version: "v1", assetToken: "tok" }),
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () => blobResponse(200, Buffer.from("hi"), "text/plain"),
        },
      ]);

      const outcome = await readAsset(SLUG, ASSET_ID);

      expect(outcome.kind === "ok" && outcome.value.ownership).toBe("reader");
    });

    it("re-probes once when the token has expired", async () => {
      let probes = 0;
      stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () => {
            probes++;
            return jsonResponse(200, {
              version: "v1",
              assetToken: `tok-${probes}`,
              perm: { mode: "owner" },
            });
          },
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () =>
            probes === 1
              ? textResponse(401, "expired", "Unauthorized")
              : blobResponse(200, Buffer.from("fresh"), "text/plain"),
        },
      ]);

      const outcome = await readAsset(SLUG, ASSET_ID);

      expect(probes).toBe(2);
      expect(outcome.kind === "ok" && outcome.value.bytes.toString()).toBe(
        "fresh",
      );
    });

    it("gives up after two refusals", async () => {
      stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () =>
            jsonResponse(200, {
              version: "v1",
              assetToken: "tok-1",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () => textResponse(401, "", "Unauthorized"),
        },
      ]);

      const outcome = await readAsset(SLUG, ASSET_ID);

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("refused with HTTP 401 twice");
    });

    it("reports metadata without an asset token", async () => {
      stubFetchRoutes([
        {
          match: () => true,
          respond: () => jsonResponse(200, { version: "v1" }),
        },
      ]);

      const outcome = await readAsset(SLUG, ASSET_ID);

      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toContain("did not include an asset token");
    });
  });
});
