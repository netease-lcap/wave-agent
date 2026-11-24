import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "fs";
import { readFile, realpath, stat } from "fs/promises";

vi.mock("../../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
    getSSOToken: vi.fn(),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/utils/toolResultStorage.js", () => ({
  persistToolResult: vi.fn(),
  persistToolResultBuffer: vi.fn(),
  buildPersistedOutputMessage: vi.fn(),
  generatePreview: vi.fn(),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}));

import { authService } from "../../../src/services/authService.js";
import { persistToolResultBuffer } from "../../../src/utils/toolResultStorage.js";
import { artifactTool } from "../../../src/tools/artifactTool.js";
import type { ToolContext, ToolResult } from "../../../src/tools/types.js";
import {
  clearArtifactSession,
  markArtifactReadApproved,
} from "../../../src/services/artifactSession.js";
import {
  renderArtifactResultData,
  type ArtifactResultData,
} from "../../../src/tools/resultData/artifact.js";

/**
 * Golden 断言（issue #3055）：`Artifact` 的 `data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` **逐字相等**。阶段 2 起八个 action 的正文
 * 都在 `data` 里（`read` 的 HTML / reader 摘要、`read_asset` 的资产原文），所以没有
 * 一支靠 `undefined` 退回 `content`。评论那族与 watch / status 已随 #3059 搬去
 * `ArtifactComments` 工具或删除，这里不再覆盖。
 *
 * 断言的期望值是手写的字面量，不是从 `content` 抄来的：抄一遍只能证明两边用了
 * 同一个渲染器，证明不了措辞没漂。
 */

const SESSION_ID = "artifact-result-data";
const SERVER_URL = "https://server.test";
const SLUG = "abc";
const ARTIFACT_URL = `${SERVER_URL}/code/artifact/${SLUG}`;
const ASSET_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ASSET_ID = "fedcba9876543210fedcba9876543210";
const SHARING_PRIVATE = [
  "Sharing: private — only you can open it, other people cannot open the link until it is shared.",
  "You cannot change sharing; that is done from the page's Share menu.",
].join("\n");

// --- fetch 与文件系统脚手架（照 artifactTool*.test.ts 的口径） ---

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function textResponse(status: number, body: string): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(body),
  };
}

function blobResponse(body: Buffer, contentType: string): Partial<Response> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => contentType },
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(
        body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as ArrayBuffer,
      ),
  } as unknown as Partial<Response>;
}

interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  respond: () => Partial<Response>;
}

function stubFetch(routes: Route[]): Mock {
  const impl = vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`No mock route for ${url}`);
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

/** 渲染 `data` 并断言它逐字等于手写的期望文本（同时等于工具给的 `content`）。 */
function expectRenders(expected: string, result: ToolResult) {
  expect(result.content).toBe(expected);
  expect(renderArtifactResultData(result.data as ArtifactResultData)).toBe(
    expected,
  );
}

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

describe("Artifact data → 文本 golden", () => {
  describe("publish", () => {
    it("201：头部几行 + 共享说明", async () => {
      vi.mocked(readFileSync).mockReturnValue("# Hi");
      stubFetch([
        {
          match: (url) => url.includes("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(201, {
              url: ARTIFACT_URL,
              slug: SLUG,
              path: "doc.md",
              title: "Doc",
              version: 3,
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "publish", file_path: "doc.md" },
        makeContext(),
      );

      expectRenders(
        [
          `Artifact published: ${ARTIFACT_URL}`,
          "Path: doc.md",
          "Title: Doc",
          "Version: 3",
          SHARING_PRIVATE,
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "publish",
        url: ARTIFACT_URL,
        version: "3",
        path: "doc.md",
        title: "Doc",
        // 宿主卡片的名字（回退链 title → label → 文件名），服务端这例给了 title。
        artifactTitle: "Doc",
        sharing: SHARING_PRIVATE,
      });
    });

    it("409：没有 data，正文是空串（冲突走 error）", async () => {
      vi.mocked(readFileSync).mockReturnValue("# Hi");
      stubFetch([
        {
          match: (url) => url.includes("/api/frame/deploy/direct"),
          respond: () =>
            jsonResponse(409, {
              live: 5,
              error: "the artifact has been updated by someone else",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "publish", file_path: "doc.md" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.data).toBeUndefined();
      expect(result.error).toBe(
        'Artifact: conflict detected — the artifact has been updated by someone else (live version: 5). Pass "force": true to overwrite the live version.',
      );
    });

    it("文件读不到时同样没有 data", async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = await artifactTool.execute(
        { action: "publish", file_path: "missing.md" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.data).toBeUndefined();
      expect(result.error).toBe(
        "Artifact: file not found or unreadable: missing.md",
      );
    });
  });

  describe("list", () => {
    const frame = (overrides: Record<string, unknown> = {}) => ({
      slug: SLUG,
      title: "Design notes",
      rel: "mine",
      updatedAt: "2026-09-29T10:00:00Z",
      favicon: "📄",
      ...overrides,
    });

    const stubFrames = (rows: unknown[]) =>
      stubFetch([
        {
          match: (url) => url.includes("/api/frame/frames"),
          respond: () => jsonResponse(200, { frames: rows }),
        },
      ]);

    it("空列表：一句 No artifacts matched", async () => {
      stubFrames([]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expectRenders(
        [
          "Artifacts (scope: mine) — 0 listed",
          "",
          "No artifacts matched.",
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "list",
        scope: "mine",
        artifacts: [],
        truncated: false,
        maxLimit: 50,
      });
    });

    it("mine / shared 分组，favicon 与更新时间各自带上", async () => {
      stubFrames([frame(), { slug: "xyz", title: "Team page", rel: "shared" }]);

      const result = await artifactTool.execute(
        { action: "list", scope: "all" },
        makeContext(),
      );

      expectRenders(
        [
          "Artifacts (scope: all) — 2 listed",
          "",
          "(mine)",
          `- 📄 Design notes — ${ARTIFACT_URL} (updated 2026-09-29T10:00:00Z)`,
          "",
          "(shared)",
          `- Team page — ${SERVER_URL}/code/artifact/xyz`,
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "list",
        scope: "all",
        artifacts: [
          {
            title: "Design notes",
            url: ARTIFACT_URL,
            rel: "mine",
            favicon: "📄",
            updatedAt: "2026-09-29T10:00:00Z",
          },
          {
            title: "Team page",
            url: `${SERVER_URL}/code/artifact/xyz`,
            rel: "shared",
          },
        ],
        truncated: false,
        maxLimit: 50,
      });
    });

    it("截断时补一句抬 limit 的提示", async () => {
      stubFrames([frame(), frame({ slug: "xyz", title: "Second" })]);

      const result = await artifactTool.execute(
        { action: "list", limit: 1 },
        makeContext(),
      );

      expectRenders(
        [
          "Artifacts (scope: mine) — 1 listed",
          "",
          "(mine)",
          `- 📄 Design notes — ${ARTIFACT_URL} (updated 2026-09-29T10:00:00Z)`,
          "",
          'More matches exist — raise "limit" (max 50) or narrow "scope".',
        ].join("\n"),
        result,
      );
      expect(result.data).toMatchObject({ truncated: true, maxLimit: 50 });
    });

    it("取列表失败时没有 data", async () => {
      stubFetch([
        {
          match: (url) => url.includes("/api/frame/frames"),
          respond: () => jsonResponse(401, {}),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "list" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.data).toBeUndefined();
      expect(result.error).toBe(
        "Artifact: authentication failed (HTTP 401). Run /login again and retry.",
      );
    });
  });

  describe("read", () => {
    const CONTENT_URL = `/api/frame/${SLUG}/content`;
    const HTML = "<!DOCTYPE html><html><body><h1>Plain HTML</h1></body></html>";

    const stubRead = (meta: unknown, html: string) =>
      stubFetch([
        {
          match: (url) => url.includes("via=model_read"),
          respond: () => jsonResponse(200, meta),
        },
        {
          match: (url) => url === `${SERVER_URL}${CONTENT_URL}`,
          respond: () => textResponse(200, html),
        },
      ]);

    it("owner：头部 + HTML 全文，全文就在 data.body 里", async () => {
      stubRead(
        {
          slug: SLUG,
          version: "v2",
          perm: { mode: "owner", role: "owner" },
          contentUrl: CONTENT_URL,
        },
        HTML,
      );

      const result = await artifactTool.execute(
        { action: "read", url: SLUG },
        makeContext(),
      );

      expectRenders(
        [
          `Artifact: ${ARTIFACT_URL}`,
          "Version: v2",
          SHARING_PRIVATE,
          "",
          HTML,
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "read",
        url: ARTIFACT_URL,
        ownership: "owner",
        bytes: HTML.length,
        // 读回来的页面 HTML 全文（大字段，阶段 2 从 content 搬进来）。
        body: HTML,
        version: "v2",
        sharing: SHARING_PRIVATE,
      });
    });

    it("reader：正文是快速模型的摘要（共享说明在前），全文就在 data.body 里", async () => {
      stubRead(
        {
          slug: SLUG,
          version: "v3",
          perm: { mode: "users", role: "reader" },
          contentUrl: CONTENT_URL,
        },
        "<html><body><h1>Their page</h1></body></html>",
      );
      // 他人页面要先过一次确认；这里预批准，测的是文本而不是闸门。
      markArtifactReadApproved(SESSION_ID, SLUG);
      const summary = "该页面分三栏：左侧目录，中间正文，右侧评论。";
      const context = makeContext({
        aiManager: {
          getModelConfig: vi.fn().mockReturnValue({
            model: "gpt-4",
            fastModel: "gpt-3.5-turbo",
          }),
          getGatewayConfig: vi.fn().mockReturnValue({ apiKey: "k" }),
        } as unknown as ToolContext["aiManager"],
        aiService: {
          processWebContent: vi.fn().mockResolvedValue({ content: summary }),
        } as unknown as ToolContext["aiService"],
      });

      const result = await artifactTool.execute(
        { action: "read", url: SLUG, prompt: "What is the layout?" },
        context,
      );

      const sharing = [
        "Sharing: this page is shared with you by someone else — you are a reader, so this session can never publish to it. Publish a new artifact instead.",
        "You cannot change sharing; that is done from the page's Share menu.",
      ].join("\n");
      expectRenders(`${sharing}\n\n${summary}`, result);
      expect(result.data).toEqual({
        action: "read",
        url: ARTIFACT_URL,
        ownership: "reader",
        // reader 档的正文就是这段摘要（阶段 2 起它随 `body` 落进 `data`）。
        body: `${sharing}\n\n${summary}`,
        version: "v3",
        sharing,
      });
      // 第三方的原始 HTML 不进对话，模型只看到摘要。
      expect(result.content).not.toContain("Their page");
    });

    it("未登录：没有 data", async () => {
      (authService.getSSOToken as Mock).mockReturnValue(null);

      const result = await artifactTool.execute(
        { action: "read", url: SLUG },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.data).toBeUndefined();
      expect(result.error).toBe(
        "Artifact: not authenticated. Run /login to connect your account before reading artifacts.",
      );
    });
  });

  describe("upload_asset", () => {
    const stubLocalFile = () => {
      vi.mocked(realpath).mockResolvedValue("/test/workdir/logo.png");
      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        size: 1024,
        ino: 7,
        mtimeMs: 111,
      } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(readFile).mockResolvedValue(
        Buffer.from("png-bytes") as unknown as Awaited<
          ReturnType<typeof readFile>
        >,
      );
    };

    it("成功：id / 引用写法 / 类型 / 体积 / sha256", async () => {
      stubLocalFile();
      stubFetch([
        {
          match: (url) => url.includes("/agent-upload"),
          respond: () =>
            jsonResponse(200, {
              opaque_id: ASSET_ID,
              content_type: "image/png",
              size_bytes: 1024,
              sha256: "deadbeef",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "upload_asset", url: ARTIFACT_URL, file_path: "logo.png" },
        makeContext(),
      );

      expectRenders(
        [
          `Asset uploaded: ${ASSET_ID}`,
          `Reference it in the page as: _blob/${ASSET_ID}`,
          "Type: image/png",
          "Size: 1.0KB",
          "sha256: deadbeef",
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "upload_asset",
        id: ASSET_ID,
        content_type: "image/png",
        size_bytes: 1024,
        sha256: "deadbeef",
      });
    });

    it("缺 file_path：没有 data", async () => {
      const result = await artifactTool.execute(
        { action: "upload_asset", url: ARTIFACT_URL },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.data).toBeUndefined();
      expect(result.error).toBe(
        'Artifact: missing required parameter "file_path" for an upload_asset',
      );
    });
  });

  describe("list_assets", () => {
    it("配额头 + 行 + 下一页游标", async () => {
      stubFetch([
        {
          match: (url) => url.includes("/agent-list"),
          respond: () =>
            jsonResponse(200, {
              assets: [
                {
                  opaque_id: ASSET_ID,
                  content_type: "image/png",
                  size_bytes: 1024,
                  created_at: "2026-10-01T00:00:00Z",
                },
              ],
              usage: {
                files: 1,
                bytes: 1024,
                max_files: 100,
                max_bytes: 200 * 1024 * 1024,
              },
              next: "cursor-2",
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "list_assets", url: ARTIFACT_URL },
        makeContext(),
      );

      expectRenders(
        [
          `Assets of ${ARTIFACT_URL} — 1/100 file(s), 1.0KB of 200 MiB`,
          "",
          `- ${ASSET_ID}  image/png  1.0KB  2026-10-01T00:00:00Z`,
          "",
          'More assets — call again with "after": "cursor-2"',
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "list_assets",
        url: ARTIFACT_URL,
        assets: [
          {
            id: ASSET_ID,
            size_bytes: 1024,
            content_type: "image/png",
            created_at: "2026-10-01T00:00:00Z",
          },
        ],
        usage: {
          files: 1,
          bytes: 1024,
          max_files: 100,
          max_bytes: 200 * 1024 * 1024,
        },
        next: "cursor-2",
      });
    });

    it("空库：一句 No assets", async () => {
      stubFetch([
        {
          match: (url) => url.includes("/agent-list"),
          respond: () =>
            jsonResponse(200, {
              assets: [],
              usage: {
                files: 0,
                bytes: 0,
                max_files: 100,
                max_bytes: 200 * 1024 * 1024,
              },
            }),
        },
      ]);

      const result = await artifactTool.execute(
        { action: "list_assets", url: SLUG },
        makeContext(),
      );

      expectRenders(
        [
          `Assets of ${SLUG} — 0/100 file(s), 0B of 200 MiB`,
          "",
          "No assets.",
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "list_assets",
        url: SLUG,
        assets: [],
        usage: {
          files: 0,
          bytes: 0,
          max_files: 100,
          max_bytes: 200 * 1024 * 1024,
        },
      });
    });
  });

  describe("read_asset", () => {
    const stubReadable = (body: Buffer, contentType: string) =>
      stubFetch([
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
          respond: () => blobResponse(body, contentType),
        },
      ]);

    it("二进制：落盘路径进 data，渲染器能还原全文", async () => {
      stubReadable(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expectRenders(
        [
          `Asset ${ASSET_ID} (image/png, 4B) written to /tmp/wave-tool-results/artifact-asset_1.png`,
          "Use Read to view it.",
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "read_asset",
        id: ASSET_ID,
        size_bytes: 4,
        content_type: "image/png",
        path: "/tmp/wave-tool-results/artifact-asset_1.png",
      });
    });

    it("文本：正文是资产原文，原文也在 data.body 里", async () => {
      stubReadable(Buffer.from("a,b\n1,2\n"), "text/csv");

      const result = await artifactTool.execute(
        { action: "read_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expectRenders(
        [`Asset ${ASSET_ID} (text/csv, 8B)`, "", "a,b", "1,2", ""].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "read_asset",
        id: ASSET_ID,
        size_bytes: 8,
        content_type: "text/csv",
        // 资产原文（大字段），与二进制档的 `path` 二选一。
        body: "a,b\n1,2\n",
      });
    });
  });

  describe("delete_asset", () => {
    const stubDelete = (deleted: boolean) =>
      stubFetch([
        {
          match: (url) => url.includes("/agent-delete"),
          respond: () => jsonResponse(200, { deleted }),
        },
      ]);

    it("deleted: true", async () => {
      stubDelete(true);

      const result = await artifactTool.execute(
        { action: "delete_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expectRenders(`Deleted asset ${ASSET_ID} from ${ARTIFACT_URL}.`, result);
      expect(result.data).toEqual({
        action: "delete_asset",
        id: ASSET_ID,
        url: ARTIFACT_URL,
        deleted: true,
      });
    });

    it("deleted: false（本来就不在）", async () => {
      stubDelete(false);

      const result = await artifactTool.execute(
        { action: "delete_asset", url: ARTIFACT_URL, asset_id: ASSET_ID },
        makeContext(),
      );

      expectRenders(
        `Asset ${ASSET_ID} was already gone — nothing was deleted.`,
        result,
      );
      expect(result.data).toEqual({
        action: "delete_asset",
        id: ASSET_ID,
        url: ARTIFACT_URL,
        deleted: false,
      });
    });
  });

  describe("copy_from", () => {
    it("全部确认：只列复制结果", async () => {
      stubFetch([
        {
          match: (url) => url.includes("/agent-copy"),
          respond: () =>
            jsonResponse(200, {
              assets: [
                {
                  opaque_id: OTHER_ASSET_ID,
                  from_id: ASSET_ID,
                  content_type: "image/png",
                  size_bytes: 1024,
                },
              ],
            }),
        },
      ]);

      const result = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: `${SERVER_URL}/code/artifact/def`,
          asset_ids: [ASSET_ID],
        },
        makeContext(),
      );

      expectRenders(
        [
          `Copied 1 asset(s) from def into ${ARTIFACT_URL}:`,
          `- ${ASSET_ID} → ${OTHER_ASSET_ID}  image/png  1.0KB`,
        ].join("\n"),
        result,
      );
      expect(result.data).toEqual({
        action: "copy_from",
        from: "def",
        url: ARTIFACT_URL,
        assets: [
          {
            id: OTHER_ASSET_ID,
            size_bytes: 1024,
            from_id: ASSET_ID,
            content_type: "image/png",
          },
        ],
        requested: 1,
      });
    });

    it("部分确认：补一句 Only N of M", async () => {
      stubFetch([
        {
          match: (url) => url.includes("/agent-copy"),
          respond: () =>
            jsonResponse(200, {
              assets: [
                {
                  opaque_id: OTHER_ASSET_ID,
                  from_id: ASSET_ID,
                  content_type: "image/png",
                  size_bytes: 1024,
                },
              ],
            }),
        },
      ]);

      const result = await artifactTool.execute(
        {
          action: "copy_from",
          url: ARTIFACT_URL,
          from: "def",
          asset_ids: [ASSET_ID, OTHER_ASSET_ID],
        },
        makeContext(),
      );

      expectRenders(
        [
          `Copied 1 asset(s) from def into ${ARTIFACT_URL}:`,
          `- ${ASSET_ID} → ${OTHER_ASSET_ID}  image/png  1.0KB`,
          "",
          "Only 1 of 2 were confirmed — run list_assets on the target to check.",
        ].join("\n"),
        result,
      );
      expect(result.data).toMatchObject({ requested: 2 });
    });
  });
});
