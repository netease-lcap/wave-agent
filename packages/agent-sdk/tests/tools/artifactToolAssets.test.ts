import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFile, realpath, stat } from "fs/promises";
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
  persistToolResultBuffer: vi
    .fn()
    .mockReturnValue("/tmp/wave-tool-results/artifact-asset_1.png"),
  buildPersistedOutputMessage: vi.fn(
    (len: number, filePath: string, preview: string) =>
      `<persisted-output>${len} chars -> ${filePath} preview: ${preview}</persisted-output>`,
  ),
  generatePreview: vi.fn((s: string) => s.substring(0, 100)),
}));

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    readFile: vi.fn(),
    realpath: vi.fn(),
    stat: vi.fn(),
  };
});

import { authService } from "../../src/services/authService.js";
import { persistToolResultBuffer } from "../../src/utils/toolResultStorage.js";
import { artifactTool } from "../../src/tools/artifactTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { clearArtifactSession } from "../../src/services/artifactSession.js";

const SESSION_ID = "test-session";
const SERVER_URL = "https://server.test";
const ARTIFACT_URL = "https://server.test/code/artifact/abc";
const SLUG = "abc";
const ASSET_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ASSET_ID = "fedcba9876543210fedcba9876543210";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Nope",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
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
    size_bytes: 1024,
    sha256: "deadbeef",
    ...overrides,
  };
}

/** Stub the upload/list/copy/delete asset endpoints. */
function stubAssetEndpoints(
  handlers: {
    upload?: () => Partial<Response>;
    list?: () => Partial<Response>;
    copy?: () => Partial<Response>;
    delete?: () => Partial<Response>;
  } = {},
): Mock {
  return stubFetchRoutes([
    {
      match: (url) => url.includes("/agent-upload"),
      respond: handlers.upload ?? (() => jsonResponse(200, assetRecord())),
    },
    {
      match: (url) => url.includes("/agent-list"),
      respond:
        handlers.list ??
        (() =>
          jsonResponse(200, {
            assets: [assetRecord()],
            usage: {
              files: 1,
              bytes: 1024,
              max_files: 100,
              max_bytes: 200 * 1024 * 1024,
            },
          })),
    },
    {
      match: (url) => url.includes("/agent-copy"),
      respond:
        handlers.copy ??
        (() =>
          jsonResponse(200, {
            assets: [
              assetRecord({ opaque_id: OTHER_ASSET_ID, from_id: ASSET_ID }),
            ],
          })),
    },
    {
      match: (url) => url.includes("/agent-delete"),
      respond: handlers.delete ?? (() => jsonResponse(200, { deleted: true })),
    },
  ]);
}

function stubLocalFile(
  options: {
    size?: number;
    isFile?: boolean;
    resolved?: string;
    content?: string;
  } = {},
) {
  const {
    size = 1024,
    isFile = true,
    resolved = "/test/workdir/logo.png",
    content = "png-bytes",
  } = options;
  vi.mocked(realpath).mockResolvedValue(resolved);
  vi.mocked(stat).mockResolvedValue({
    isFile: () => isFile,
    size,
    ino: 7,
    mtimeMs: 111,
  } as unknown as Awaited<ReturnType<typeof stat>>);
  vi.mocked(readFile).mockResolvedValue(
    Buffer.from(content) as unknown as Awaited<ReturnType<typeof readFile>>,
  );
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
      isPathInSafeZone: vi.fn().mockReturnValue(true),
    },
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: SESSION_ID,
    permissionMode: "default",
    ...overrides,
  } as ToolContext;
}

describe("artifactTool asset actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearArtifactSession(SESSION_ID);
    (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
    (authService.getSSOToken as Mock).mockReturnValue("token123");
    (persistToolResultBuffer as Mock).mockReturnValue(
      "/tmp/wave-tool-results/artifact-asset_1.png",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearArtifactSession(SESSION_ID);
  });

  describe("upload_asset", () => {
    it("uploads a local file as raw bytes with the mapped content type", async () => {
      const { manager, permissionContext } = makePermissionManager();
      stubLocalFile();
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(`Asset uploaded: ${ASSET_ID}`);
      expect(result.content).toContain(`_blob/${ASSET_ID}`);
      expect(result.content).toContain("Type: image/png");
      expect(result.content).toContain("sha256: deadbeef");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/blob/${SLUG}/agent-upload`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "image/png",
      );
      expect(Buffer.from(init.body as Uint8Array).toString()).toBe("png-bytes");

      // The write is confirmed, and the standing rule is hidden.
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);
      expect(permissionContext.hidePersistentOption).toBe(true);
      expect(String(permissionContext.warning)).toContain("logo.png");
    });

    it("accepts a bare slug in place of a page URL", async () => {
      stubLocalFile();
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: SLUG },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${SERVER_URL}/api/frame/blob/${SLUG}/agent-upload`,
      );
    });

    it("rejects an extension the asset store does not accept, without a request", async () => {
      const fetchMock = stubAssetEndpoints();
      stubLocalFile({ resolved: "/test/workdir/installer.exe" });

      const result = await artifactTool.execute(
        {
          action: "upload_asset",
          file_path: "installer.exe",
          url: ARTIFACT_URL,
        },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("only these file types are accepted");
      expect(result.error).toContain(".png");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a network path before touching the filesystem", async () => {
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        {
          action: "upload_asset",
          file_path: "//fileserver/share/logo.png",
          url: ARTIFACT_URL,
        },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("network path");
      expect(realpath).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects something that is not a regular file", async () => {
      stubLocalFile({ isFile: false });

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "assets", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("must name a regular file");
    });

    it("rejects a file outside the readable zone", async () => {
      const { manager } = makePermissionManager();
      manager.isPathInSafeZone.mockReturnValue(false);
      stubLocalFile();
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        {
          action: "upload_asset",
          file_path: "/etc/logo.png",
          url: ARTIFACT_URL,
        },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the working directory");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("checks the file's resolved location, not its spelling", async () => {
      stubLocalFile({ resolved: "/test/workdir/real/logo.png" });
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        {
          action: "upload_asset",
          file_path: "link/logo.png",
          url: ARTIFACT_URL,
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(realpath).toHaveBeenCalledWith("/test/workdir/link/logo.png");
      expect(stat).toHaveBeenCalledWith("/test/workdir/real/logo.png");
      expect(readFile).toHaveBeenCalledWith("/test/workdir/real/logo.png");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects an empty file", async () => {
      stubLocalFile({ size: 0 });

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("is empty — nothing to upload");
    });

    it("rejects a file over the per-asset ceiling", async () => {
      stubLocalFile({ size: 21 * 1024 * 1024 });
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "big.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("over the 20 MiB per-asset limit");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("applies the tighter SVG ceiling", async () => {
      stubLocalFile({
        size: 3 * 1024 * 1024,
        resolved: "/test/workdir/icon.svg",
      });

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "icon.svg", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("over the 2 MiB SVG per-asset limit");
    });

    it("aborts when the file changed while it was being read", async () => {
      stubLocalFile();
      vi.mocked(stat)
        .mockResolvedValueOnce({
          isFile: () => true,
          size: 1024,
          ino: 7,
          mtimeMs: 111,
        } as unknown as Awaited<ReturnType<typeof stat>>)
        .mockResolvedValueOnce({
          isFile: () => true,
          size: 900,
          ino: 9,
          mtimeMs: 222,
        } as unknown as Awaited<ReturnType<typeof stat>>);
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("was rewritten during the read");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("aborts when the file vanished after the read", async () => {
      stubLocalFile();
      vi.mocked(stat)
        .mockResolvedValueOnce({
          isFile: () => true,
          size: 1024,
          ino: 7,
          mtimeMs: 111,
        } as unknown as Awaited<ReturnType<typeof stat>>)
        .mockRejectedValueOnce(new Error("ENOENT"));

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("was moved, was replaced");
    });

    it("requires url and file_path", async () => {
      const missingUrl = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png" },
        makeContext(),
      );
      expect(missingUrl.success).toBe(false);
      expect(missingUrl.error).toContain('missing required parameter "url"');

      const badUrl = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: "not a url" },
        makeContext(),
      );
      expect(badUrl.success).toBe(false);
      expect(badUrl.error).toContain("url must be an artifact page URL");

      const missingFile = await artifactTool.execute(
        { action: "upload_asset", url: ARTIFACT_URL },
        makeContext(),
      );
      expect(missingFile.success).toBe(false);
      expect(missingFile.error).toContain(
        'missing required parameter "file_path"',
      );
    });

    it("asks the user to log in first", async () => {
      (authService.getSSOToken as Mock).mockReturnValue(undefined);
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not authenticated");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(realpath).not.toHaveBeenCalled();
    });

    it("stops when the user denies the write", async () => {
      const { manager } = makePermissionManager("deny");
      stubLocalFile();
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied by user");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("confirms once per artifact per session", async () => {
      const { manager } = makePermissionManager();
      stubLocalFile();
      stubAssetEndpoints();
      const context = makeContext({ permissionManager: manager as never });

      await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        context,
      );
      await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        context,
      );
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);

      // A different artifact is its own decision.
      await artifactTool.execute(
        {
          action: "upload_asset",
          file_path: "logo.png",
          url: "https://server.test/code/artifact/other",
        },
        context,
      );
      expect(manager.checkPermission).toHaveBeenCalledTimes(2);
    });

    it("passes the server's content-type rejection through", async () => {
      stubLocalFile();
      stubAssetEndpoints({
        upload: () =>
          textResponse(415, '{"error":{"message":"content type has params"}}'),
      });

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("bare MIME type");
    });

    it("explains a read-only artifact", async () => {
      stubLocalFile();
      stubAssetEndpoints({
        upload: () => textResponse(403, "not a writer"),
      });

      const result = await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("only the artifact's owner or a writer");
    });
  });

  describe("list_assets", () => {
    it("lists assets with quota usage", async () => {
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "list_assets", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("1/100 file(s)");
      expect(result.content).toContain("1.0KB of 200 MiB");
      expect(result.content).toContain(ASSET_ID);
      expect(result.content).toContain("image/png");
      expect(result.shortResult).toBe(`Listed 1 asset(s) of ${SLUG}`);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/blob/${SLUG}/agent-list`);
      expect(JSON.parse(init.body as string)).toEqual({ limit: 50 });
    });

    it("passes a cursor through and points at the next one", async () => {
      const fetchMock = stubAssetEndpoints({
        list: () =>
          jsonResponse(200, {
            assets: [],
            usage: { files: 0, bytes: 0, max_files: 10, max_bytes: 10 },
            next: "cursor-2",
          }),
      });

      const result = await artifactTool.execute(
        { action: "list_assets", url: ARTIFACT_URL, after: "cursor-1" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("No assets.");
      expect(result.content).toContain('call again with "after": "cursor-2"');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        limit: 50,
        after: "cursor-1",
      });
    });

    it("does not confirm read-only access", async () => {
      const { manager } = makePermissionManager();
      stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "list_assets", url: ARTIFACT_URL },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(true);
      expect(manager.checkPermission).not.toHaveBeenCalled();
    });

    it("reports a rejected cursor", async () => {
      stubAssetEndpoints({
        list: () => textResponse(400, '{"error":{"code":"invalid_request"}}'),
      });

      const result = await artifactTool.execute(
        { action: "list_assets", url: ARTIFACT_URL, after: "bogus" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid_request");
    });
  });

  describe("read_asset", () => {
    function stubReadable(
      meta: Record<string, unknown>,
      body: Buffer,
      contentType: string,
    ): Mock {
      return stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () => jsonResponse(200, meta),
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () => blobResponse(200, body, contentType),
        },
      ]);
    }

    it("inlines a textual asset without a session Bearer token", async () => {
      const fetchMock = stubReadable(
        { version: "v3", assetToken: "tok", perm: { mode: "owner" } },
        Buffer.from("a,b\n1,2\n"),
        "text/csv",
      );

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(`Asset ${ASSET_ID} (text/csv`);
      expect(result.content).toContain("a,b\n1,2");

      expect(fetchMock.mock.calls[1][0]).toBe(
        `${SERVER_URL}/_f/v3/_blob/${ASSET_ID}?__frame_t=tok`,
      );
      expect(
        (fetchMock.mock.calls[1][1] as RequestInit).headers,
      ).toBeUndefined();
    });

    it("accepts a _blob reference as the asset id", async () => {
      const fetchMock = stubReadable(
        { version: "v3", assetToken: "tok", perm: { mode: "owner" } },
        Buffer.from("x"),
        "text/plain",
      );

      const result = await artifactTool.execute(
        {
          action: "read_asset",
          url: ARTIFACT_URL,
          asset_id: `_blob/${ASSET_ID}`,
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[1][0]).toContain(`/_blob/${ASSET_ID}`);
    });

    it("writes a binary asset to a temp file instead of inlining it", async () => {
      stubReadable(
        { version: "v3", assetToken: "tok", perm: { mode: "owner" } },
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        "image/png",
      );

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        "written to /tmp/wave-tool-results/artifact-asset_1.png",
      );
      expect(persistToolResultBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        "artifact-asset",
        "png",
      );
    });

    it("confirms before putting someone else's asset in context", async () => {
      const { manager } = makePermissionManager();
      stubReadable(
        { version: "v3", assetToken: "tok", perm: { mode: "users" } },
        Buffer.from("shared"),
        "text/plain",
      );

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(true);
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(manager.createContext.mock.calls[0][3])).toContain(
        ASSET_ID,
      );
    });

    it("stops when the reader confirms nothing", async () => {
      const { manager } = makePermissionManager("deny");
      stubReadable(
        { version: "v3", assetToken: "tok", perm: { mode: "users" } },
        Buffer.from("shared"),
        "text/plain",
      );

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied by user");
    });

    it("does not re-confirm someone else's asset in the same session", async () => {
      const { manager } = makePermissionManager();
      stubReadable(
        { version: "v3", assetToken: "tok", perm: { mode: "users" } },
        Buffer.from("shared"),
        "text/plain",
      );
      const context = makeContext({ permissionManager: manager as never });

      await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        context,
      );
      await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: OTHER_ASSET_ID },
        context,
      );

      expect(manager.checkPermission).toHaveBeenCalledTimes(1);
    });

    it("requires a usable asset id", async () => {
      const missing = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL },
        makeContext(),
      );
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('missing required parameter "asset_id"');

      const malformed = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: "nope" },
        makeContext(),
      );
      expect(malformed.success).toBe(false);
      expect(malformed.error).toContain("must be a 32-character hex asset id");
    });

    it("reports an asset that is not in the artifact", async () => {
      stubFetchRoutes([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () =>
            jsonResponse(200, {
              version: "v3",
              assetToken: "tok",
              perm: { mode: "owner" },
            }),
        },
        {
          match: (url) => url.includes("/_blob/"),
          respond: () =>
            textResponse(404, '{"error":{"code":"asset_not_found"}}'),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("asset read failed: asset_not_found");
    });
  });

  describe("delete_asset", () => {
    it("deletes and confirms once per artifact", async () => {
      const { manager } = makePermissionManager();
      const fetchMock = stubAssetEndpoints();
      const context = makeContext({ permissionManager: manager as never });

      const result = await artifactTool.execute(
        { action: "delete_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(`Deleted asset ${ASSET_ID}`);
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);

      await artifactTool.execute(
        { action: "upload_asset", file_path: "logo.png", url: ARTIFACT_URL },
        context,
      );
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${SERVER_URL}/api/frame/blob/${SLUG}/${ASSET_ID}/agent-delete`,
      );
      expect(init.method).toBe("POST");
    });

    it("treats an already-deleted asset as nothing to do", async () => {
      stubAssetEndpoints({
        delete: () => jsonResponse(200, { deleted: false }),
      });

      const result = await artifactTool.execute(
        { action: "delete_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("was already gone");
    });

    it("stops when the user denies the delete", async () => {
      const { manager } = makePermissionManager("deny");
      const fetchMock = stubAssetEndpoints();

      const result = await artifactTool.execute(
        { action: "delete_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied by user");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("copy_from", () => {
    it("copies the requested ids into the target artifact", async () => {
      const { manager } = makePermissionManager();
      const fetchMock = stubAssetEndpoints({
        copy: () =>
          jsonResponse(200, {
            assets: [
              assetRecord({ opaque_id: "c".repeat(32), from_id: ASSET_ID }),
            ],
          }),
      });

      const result = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "source-slug",
          asset_ids: [ASSET_ID],
        },
        makeContext({ permissionManager: manager as never }),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        `Copied 1 asset(s) from source-slug into ${ARTIFACT_URL}`,
      );
      expect(result.content).toContain(`${ASSET_ID} → ${"c".repeat(32)}`);
      expect(manager.checkPermission).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SERVER_URL}/api/frame/blob/${SLUG}/agent-copy`);
      expect(JSON.parse(init.body as string)).toEqual({
        from: "source-slug",
        ids: [ASSET_ID],
      });
    });

    it("warns when the server confirmed fewer copies than asked", async () => {
      stubAssetEndpoints();

      const result = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "source-slug",
          asset_ids: [ASSET_ID, OTHER_ASSET_ID],
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Only 1 of 2 were confirmed");
    });

    it("rejects a missing or unusable source", async () => {
      const missing = await artifactTool.execute(
        { action: "copy_from", url: ARTIFACT_URL, asset_ids: [ASSET_ID] },
        makeContext(),
      );
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('missing required parameter "from"');

      const malformed = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "not a slug!",
          asset_ids: [ASSET_ID],
        },
        makeContext(),
      );
      expect(malformed.success).toBe(false);
      expect(malformed.error).toContain(
        "from must be an artifact slug or page URL",
      );
    });

    it("enforces the 1-10 distinct id contract without a request", async () => {
      const fetchMock = stubAssetEndpoints();

      const empty = await artifactTool.execute(
        { action: "copy_from", url: ARTIFACT_URL, from: "src", asset_ids: [] },
        makeContext(),
      );
      expect(empty.success).toBe(false);
      expect(empty.error).toContain("non-empty array of asset ids");

      const none = await artifactTool.execute(
        { action: "copy_from", url: ARTIFACT_URL, from: "src" },
        makeContext(),
      );
      expect(none.success).toBe(false);
      expect(none.error).toContain("non-empty array of asset ids");

      const tooMany = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "src",
          asset_ids: Array.from({ length: 11 }, (_, i) =>
            i.toString(16).padStart(32, "0").slice(-32),
          ),
        },
        makeContext(),
      );
      expect(tooMany.success).toBe(false);
      expect(tooMany.error).toContain("at most 10 ids (got 11)");

      const duplicated = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "src",
          asset_ids: [ASSET_ID, ASSET_ID],
        },
        makeContext(),
      );
      expect(duplicated.success).toBe(false);
      expect(duplicated.error).toContain('"asset_ids" must be distinct');

      const malformed = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "src",
          asset_ids: ["nope"],
        },
        makeContext(),
      );
      expect(malformed.success).toBe(false);
      expect(malformed.error).toContain("entries must be 32-character hex");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("explains a read-only source or target", async () => {
      stubAssetEndpoints({
        copy: () => textResponse(403, "not a writer"),
      });

      const result = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "source-slug",
          asset_ids: [ASSET_ID],
        },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("only the artifact's owner or a writer");
    });
  });

  describe("authentication gate", () => {
    it("asks for a login on every asset action", async () => {
      (authService.getSSOToken as Mock).mockReturnValue(undefined);
      const fetchMock = stubAssetEndpoints();

      const calls: Array<Record<string, unknown>> = [
        { action: "list_assets", url: ARTIFACT_URL },
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        { action: "delete_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "src",
          asset_ids: [ASSET_ID],
        },
      ];
      for (const args of calls) {
        const result = await artifactTool.execute(args, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toContain("not authenticated");
        expect(result.error).toContain(`${ARTIFACT_TOOL_NAME}`);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
