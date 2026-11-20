import { describe, it, expect, vi, beforeEach } from "vitest";
import { open, readFile, stat } from "fs/promises";
import {
  buildTranscriptManifest,
  exportTranscriptArchive,
  renderTranscriptMarkdown,
  TRANSCRIPT_EXPORT_MAX_JSONL_BYTES,
} from "../../src/services/transcriptArchive.js";
import { forEachLine } from "../../src/utils/fileUtils.js";
import type {
  Message,
  MessageBlock,
  ToolBlock,
} from "../../src/types/messaging.js";

/**
 * 桌面端 `/export` 的归档那一半：可读版（Markdown）、`manifest.json`、原始字节。
 *
 * 这里钉住三条「写错就出事故」的口径：
 *
 * - **绝不写图片 base64**：一张 4 MB 的截图能让归档从「能发出去」变成「发不出去」；
 * - **原始字节原样拷贝**：`transcript.jsonl` 是那份文件本身的拷贝，不重新序列化，
 *   否则它就不再是取证意义上的原始转录；
 * - **超 50 MB 只丢原始转录、不丢可读版**，且要在清单里说清为什么少了它。
 */

vi.mock("fs/promises", () => ({
  open: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("../../src/utils/fileUtils.js", () => ({ forEachLine: vi.fn() }));

const FILE = "/fake/session.jsonl";
const HEADER = {
  type: "metadata",
  version: 1,
  sessionId: "s1",
  workdir: "/fake/project",
  createdAt: "2026-01-01T00:00:00.000Z",
  gitBranch: "main",
};

/** 让 `forEachLine` 吐出一份「文件」：行数组按顺序喂。 */
function serveLines(lines: string[]) {
  vi.mocked(forEachLine).mockImplementation(async (_filePath, onLine) => {
    for (const line of lines) await onLine(line);
    return { endsWithNewline: true };
  });
}

/**
 * 一份完整的转录「文件」：`stat` 报大小、`readFile` 报字节、`open` 报首行、
 * `forEachLine` 报逐行 —— 四个读入口指向同一份内容，测试才谈得上「原样」。
 */
function serveFile(content: string) {
  const bytes = Buffer.from(content, "utf8");
  vi.mocked(stat).mockResolvedValue({
    size: bytes.length,
  } as unknown as Awaited<ReturnType<typeof stat>>);
  vi.mocked(readFile).mockResolvedValue(
    bytes as unknown as Awaited<ReturnType<typeof readFile>>,
  );
  vi.mocked(open).mockResolvedValue({
    read: async (buffer: Buffer, offset: number, length: number) => {
      const slice = bytes.subarray(0, Math.min(length, bytes.length));
      slice.copy(buffer, offset);
      return { bytesRead: slice.length, buffer };
    },
    close: async () => {},
  } as unknown as Awaited<ReturnType<typeof open>>);
  serveLines(content.split("\n"));
}

function userMessage(id: string, text: string): Message {
  return {
    id,
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content: text }],
  };
}

function assistantMessage(blocks: MessageBlock[]): Message {
  return {
    id: "a1",
    role: "assistant",
    timestamp: "2026-01-01T00:00:01.000Z",
    blocks,
  };
}

const ZERO_STATS = {
  messages: 1,
  injectedMessages: 0,
  toolCalls: 0,
  images: 0,
};

/** 一张只带头部的 PNG（24 字节够 `pngSize` 读出宽高，不需要真的像素数据）。 */
function pngDataUrl(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

beforeEach(() => {
  vi.mocked(stat).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(open).mockReset();
  vi.mocked(forEachLine).mockReset();
});

describe("renderTranscriptMarkdown", () => {
  it("标题 → 会话事实 → 逐条消息，事实缺哪条就不写哪条", () => {
    const markdown = renderTranscriptMarkdown([userMessage("m1", "你好")], {
      workdir: "/fake/project",
      gitBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      exportedAt: "2026-01-02T00:00:00.000Z",
      stats: ZERO_STATS,
    });

    expect(markdown).toBe(
      [
        "# 会话记录",
        [
          "- 工作目录：`/fake/project`",
          "- Git 分支：main",
          "- 创建时间：2026-01-01T00:00:00.000Z",
          "- 导出时间：2026-01-02T00:00:00.000Z",
          "- 规模：1 条消息 · 0 次工具调用",
        ].join("\n"),
        "## 用户\n\n你好",
      ].join("\n\n") + "\n",
    );
  });

  it("标题用用户起的那个；只有空白时回落到「会话记录」", () => {
    expect(
      renderTranscriptMarkdown([], {
        title: "  排查导出  ",
        stats: ZERO_STATS,
      }),
    ).toBe("# 排查导出\n\n- 规模：1 条消息 · 0 次工具调用\n");
    expect(
      renderTranscriptMarkdown([], { title: " ", stats: ZERO_STATS }),
    ).toContain("# 会话记录");
  });

  it("有图片才在规模行里数图片", () => {
    const markdown = renderTranscriptMarkdown([], {
      stats: { messages: 3, injectedMessages: 0, toolCalls: 2, images: 1 },
    });
    expect(markdown).toContain("- 规模：3 条消息 · 2 次工具调用 · 1 张图片");
  });

  it("每条消息自成一段：连续两条用户消息各带一个角色标题", () => {
    const markdown = renderTranscriptMarkdown(
      [userMessage("m1", "第一句"), userMessage("m2", "第二句")],
      { stats: ZERO_STATS },
    );
    expect(markdown.match(/^## 用户$/gm)).toHaveLength(2);
    expect(markdown).toContain("## 用户\n\n第一句\n\n## 用户\n\n第二句");
  });

  it("一条消息里多个块共用一个角色标题", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          { type: "text", content: "我看一下" },
          { type: "tool", name: "Read", stage: "end", parameters: "{}" },
        ]),
      ],
      { stats: ZERO_STATS },
    );
    expect(markdown.match(/^## 助手$/gm)).toHaveLength(1);
  });

  it("压缩摘要自成「上下文压缩」一节，不套角色标题", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          { type: "text", content: "压缩前的话" },
          { type: "compact", content: "之前几轮的摘要" },
        ]),
      ],
      { stats: ZERO_STATS },
    );
    expect(markdown).toContain(
      "## 助手\n\n压缩前的话\n\n## 上下文压缩\n\n之前几轮的摘要",
    );
    // 摘要不跟着角色走：整段只有一个角色标题。
    expect(markdown.match(/^## 助手$/gm)).toHaveLength(1);
  });

  it("reasoning 一律跳过；只有 reasoning 的消息整条消失（不留空标题）", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          { type: "reasoning", content: "想了想" },
          { type: "reasoning", content: "", redacted: "opaque-payload" },
        ]),
        userMessage("m2", "在吗"),
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).not.toContain("想了想");
    expect(markdown).not.toContain("opaque-payload");
    expect(markdown).not.toContain("## 助手");
    expect(markdown).toContain("## 用户\n\n在吗");
  });

  it("工具调用：一行摘要 + 结果代码块，结果取不到时只留那一行", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          {
            type: "tool",
            name: "Read",
            stage: "end",
            parameters: '{"file_path":"/a.ts"}',
            result: "export const a = 1;",
          },
        ]),
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).toContain(
      '- `Read` — {"file_path":"/a.ts"}\n\n```\nexport const a = 1;\n```',
    );

    const streaming = renderTranscriptMarkdown(
      [
        assistantMessage([
          {
            type: "tool",
            name: "Bash",
            stage: "running",
            parameters: '{"command":"ls"}',
            result: "半截结果",
          },
        ]),
      ],
      { stats: ZERO_STATS },
    );
    // 没跑完的调用没有「结果」可言，写进去的半截参数不是结论。
    expect(streaming).toContain('- `Bash` — {"command":"ls"}');
    expect(streaming).not.toContain("半截结果");
    expect(streaming).not.toContain("```");
  });

  it("失败的调用带「❌ 失败」，错误信息落在代码块里", () => {
    const block: ToolBlock = {
      type: "tool",
      name: "Bash",
      stage: "end",
      parameters: '{"command":"false"}',
      success: false,
      error: new Error("exit code 1"),
    };
    const markdown = renderTranscriptMarkdown([assistantMessage([block])], {
      stats: ZERO_STATS,
    });

    expect(markdown).toContain('- `Bash` — {"command":"false"} ❌ 失败');
    expect(markdown).toContain("```\nexit code 1\n```");
  });

  it("长参数与长结果都截断：参数一行 200 字，结果前 30 行", () => {
    const result = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行`).join(
      "\n",
    );
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          {
            type: "tool",
            name: "Bash",
            stage: "end",
            parameters: `{"command":"${"x".repeat(300)}"}`,
            result,
          },
        ]),
      ],
      { stats: ZERO_STATS },
    );

    const callLine =
      markdown.split("\n").find((line) => line.startsWith("- `Bash`")) ?? "";
    const params = callLine.slice(callLine.indexOf("— ") + 2);
    expect(params).toHaveLength(200); // 199 字 + 省略号
    expect(params.endsWith("…")).toBe(true);
    expect(markdown).toContain("第 30 行");
    expect(markdown).not.toContain("第 31 行");
    expect(markdown).toContain("（结果已截断：只保留前 30 行）");
  });

  it("结果里本来就有三反引号时，围栏自动加长", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          {
            type: "tool",
            name: "Read",
            stage: "end",
            parameters: "{}",
            result: "```ts\nconst a = 1;\n```",
          },
        ]),
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).toContain("````\n```ts");
    expect(markdown).toContain("```\n````");
  });

  it("图片只写尺寸与格式，绝不写 base64", () => {
    const dataUrl = pngDataUrl(1280, 720);
    const markdown = renderTranscriptMarkdown(
      [
        userMessage("m1", "看图"),
        {
          id: "m2",
          role: "user",
          timestamp: "2026-01-01T00:00:02.000Z",
          blocks: [
            { type: "image", imageUrls: [dataUrl] },
            { type: "image", imagePaths: ["/tmp/paste.png"] },
            { type: "image" },
          ],
        },
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).toContain("[图片：1280x720 / image/png]");
    expect(markdown).toContain("[图片：/tmp/paste.png]");
    expect(markdown).toContain("[图片]");
    // 载荷一个字符都不进可读版：否则归档会从「能发出去」变成「发不出去」。
    const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
    expect(markdown).not.toContain(payload);
  });

  it("读不出尺寸的 data URL 只留格式", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          { type: "image", imageUrls: ["data:image/svg+xml;base64,PHN2Zz4="] },
        ]),
      ],
      { stats: ZERO_STATS },
    );
    expect(markdown).toContain("[图片 / image/svg+xml]");
  });

  it("notice 写成引用块，级别进方括号，多行都加引用符", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          { type: "notice", level: "error", content: "请求失败\n请重试" },
          { type: "notice", level: "info", content: "🔄 第 3 轮" },
        ]),
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).toContain("> [!error] 请求失败\n> 请重试");
    expect(markdown).toContain("> [!info] 🔄 第 3 轮");
  });

  it("文件历史与后台任务通知各压成一行", () => {
    const markdown = renderTranscriptMarkdown(
      [
        assistantMessage([
          { type: "file_history", snapshots: [] },
          {
            type: "task_notification",
            taskId: "bg-1",
            taskType: "shell",
            status: "failed",
            summary: "退出码 1\n第二行不进摘要",
          },
        ]),
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).toContain("- 文件历史快照：0 个文件");
    expect(markdown).toContain(
      "- 后台任务「bg-1」（shell）：failed — 退出码 1",
    );
    expect(markdown).not.toContain("第二行不进摘要");
  });

  it("isMeta 的消息整条跳过 —— 正文里没有它，也没有包裹标记", () => {
    const markdown = renderTranscriptMarkdown(
      [
        {
          ...userMessage("m1", "<command-name>/clear</command-name>"),
          isMeta: true,
        },
        userMessage("m2", "真正说的话"),
      ],
      { stats: ZERO_STATS },
    );

    expect(markdown).not.toContain("command-name");
    expect(markdown).not.toContain("<!-- meta -->");
    expect(markdown).toContain("## 用户\n\n真正说的话");
    // 只剩一条真实消息，所以只有一个角色标题。
    expect(markdown.match(/^## 用户$/gm)).toHaveLength(1);
  });

  it("有跳过的注入消息时，规模行尾部交代一句", () => {
    const markdown = renderTranscriptMarkdown([userMessage("m1", "你好")], {
      stats: { messages: 1, injectedMessages: 3, toolCalls: 0, images: 0 },
    });
    expect(markdown).toContain(
      "- 规模：1 条消息 · 0 次工具调用（另跳过 3 条注入消息）",
    );

    // 没跳过就不带这一句 —— 零的情况下多加一个字都是噪音。
    expect(
      renderTranscriptMarkdown([userMessage("m1", "你好")], {
        stats: ZERO_STATS,
      }),
    ).toContain("- 规模：1 条消息 · 0 次工具调用\n");
  });
});

describe("buildTranscriptManifest", () => {
  it("会话事实 + 宿主事实 + 规模，缺的字段不带键", () => {
    expect(
      buildTranscriptManifest({
        workdir: "/fake/project",
        createdAt: "2026-01-01T00:00:00.000Z",
        gitBranch: "main",
        customTitle: "排查导出",
        model: "wave-1",
        stats: { messages: 4, injectedMessages: 2, toolCalls: 2, images: 1 },
        exportedAt: new Date("2026-01-02T03:04:05.000Z"),
        appVersion: "1.2.3",
        platform: "win32",
        transcriptBytes: 4096,
        jsonlIncluded: true,
      }),
    ).toEqual({
      workdir: "/fake/project",
      createdAt: "2026-01-01T00:00:00.000Z",
      gitBranch: "main",
      customTitle: "排查导出",
      model: "wave-1",
      messages: 4,
      // 真实对话 4 条 + 跳过 2 条注入：两个数分开写，拿它对 jsonl 行数时才不会以为缺了。
      injectedMessages: 2,
      toolCalls: 2,
      images: 1,
      exportedAt: "2026-01-02T03:04:05.000Z",
      appVersion: "1.2.3",
      platform: "win32",
      transcriptBytes: 4096,
      jsonlIncluded: true,
      // 子会话的转录没有进归档：明写一句，省得支持人员再问「是不是漏打包了」。
      subagentTranscripts: "unlinked",
    });

    const minimal = buildTranscriptManifest({
      stats: { messages: 0, injectedMessages: 0, toolCalls: 0, images: 0 },
      exportedAt: new Date("2026-01-02T03:04:05.000Z"),
      platform: "linux",
      transcriptBytes: 0,
      jsonlIncluded: false,
    });
    expect(Object.keys(minimal).sort()).toEqual([
      "exportedAt",
      "images",
      "injectedMessages",
      "jsonlIncluded",
      "messages",
      "platform",
      "subagentTranscripts",
      "toolCalls",
      "transcriptBytes",
    ]);
  });
});

describe("exportTranscriptArchive", () => {
  const CONTENT = [
    JSON.stringify(HEADER),
    JSON.stringify(userMessage("m1", "你好")),
    JSON.stringify({ type: "custom-title", customTitle: "第一次改名" }),
    JSON.stringify({ type: "custom-title", customTitle: "第二次改名" }),
    "",
  ].join("\n");

  it("三样东西一起算好：可读版、清单、原样拷贝的原始字节", async () => {
    serveFile(CONTENT);

    const payload = await exportTranscriptArchive({
      transcriptPath: FILE,
      workdir: "/给出错的工作目录",
      model: "wave-1",
      appVersion: "1.2.3",
      platform: "win32",
      exportedAt: new Date("2026-01-02T03:04:05.000Z"),
    });

    // 可读版：标题取最后一条改名，事实来自转录头（头里的 workdir 赢过兜底值）。
    expect(payload.markdown).toContain("# 第二次改名");
    expect(payload.markdown).toContain("- 工作目录：`/fake/project`");
    expect(payload.markdown).toContain("- Git 分支：main");
    expect(payload.markdown).toContain("- 创建时间：2026-01-01T00:00:00.000Z");
    expect(payload.markdown).toContain("- 导出时间：2026-01-02T03:04:05.000Z");
    expect(payload.markdown).not.toContain("给出错的工作目录");

    // 原始字节：base64 解出来必须与源文件逐字节相同（不重新序列化）。
    expect(payload.jsonlBase64).toBe(Buffer.from(CONTENT).toString("base64"));
    expect(
      Buffer.from(payload.jsonlBase64 ?? "", "base64").toString("utf8"),
    ).toBe(CONTENT);
    expect(payload.jsonlBytes).toBe(Buffer.byteLength(CONTENT));
    expect(payload.jsonlTooLarge).toBe(false);

    const manifest = JSON.parse(payload.manifestJson) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      workdir: "/fake/project",
      gitBranch: "main",
      createdAt: "2026-01-01T00:00:00.000Z",
      customTitle: "第二次改名",
      model: "wave-1",
      appVersion: "1.2.3",
      platform: "win32",
      messages: 1,
      injectedMessages: 0,
      toolCalls: 0,
      images: 0,
      exportedAt: "2026-01-02T03:04:05.000Z",
      transcriptBytes: Buffer.byteLength(CONTENT),
      jsonlIncluded: true,
      subagentTranscripts: "unlinked",
    });
    // 落盘时是个漂亮的文件，不是一行压扁的 JSON。
    expect(payload.manifestJson.endsWith("}\n")).toBe(true);
    expect(payload.manifestJson).toContain('\n  "workdir"');
  });

  it("注入消息不进可读版，只在清单里记一笔数", async () => {
    const injected = {
      ...userMessage("m2", "<system-reminder>技能清单…</system-reminder>"),
      isMeta: true,
    };
    serveFile(
      [
        JSON.stringify(HEADER),
        JSON.stringify(userMessage("m1", "你好")),
        JSON.stringify(injected),
        "",
      ].join("\n"),
    );

    const payload = await exportTranscriptArchive({
      transcriptPath: FILE,
      platform: "win32",
      exportedAt: new Date("2026-01-02T03:04:05.000Z"),
    });

    expect(payload.markdown).toContain("你好");
    expect(payload.markdown).not.toContain("system-reminder");
    expect(payload.markdown).not.toContain("<!-- meta -->");
    expect(payload.markdown).toContain("（另跳过 1 条注入消息）");

    const manifest = JSON.parse(payload.manifestJson) as Record<
      string,
      unknown
    >;
    expect(manifest.messages).toBe(1);
    expect(manifest.injectedMessages).toBe(1);
  });

  it("超过 50 MB：原始转录不进归档，可读版照出，清单里说明原因", async () => {
    const oversized = TRANSCRIPT_EXPORT_MAX_JSONL_BYTES + 1;
    serveFile(CONTENT);
    vi.mocked(stat).mockResolvedValue({
      size: oversized,
    } as unknown as Awaited<ReturnType<typeof stat>>);

    const payload = await exportTranscriptArchive({
      transcriptPath: FILE,
      platform: "win32",
      exportedAt: new Date("2026-01-02T03:04:05.000Z"),
    });

    expect(payload.jsonlTooLarge).toBe(true);
    expect(payload.jsonlBase64).toBeUndefined();
    // 宁可少一样东西，也不静默截断：可读版仍然完整产出。
    expect(payload.markdown).toContain("你好");
    expect(payload.jsonlBytes).toBe(oversized);
    // 一个 50 MB 的文件读都不读——上限就是在省这一次全量读。
    expect(readFile).not.toHaveBeenCalled();

    const manifest = JSON.parse(payload.manifestJson) as Record<
      string,
      unknown
    >;
    expect(manifest.jsonlIncluded).toBe(false);
    expect(manifest.transcriptBytes).toBe(oversized);
  });

  it("转录被清理掉时抛 missing，交给宿主说「可能已被 cleanupPeriodDays 清理」", async () => {
    vi.mocked(stat).mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );

    await expect(
      exportTranscriptArchive({ transcriptPath: FILE, platform: "win32" }),
    ).rejects.toMatchObject({
      name: "TranscriptUnavailableError",
      reason: "missing",
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("转录头读不出来不影响导出：事实退回调用方给的工作目录", async () => {
    serveFile(CONTENT);
    vi.mocked(open).mockRejectedValue(new Error("EACCES: permission denied"));

    const payload = await exportTranscriptArchive({
      transcriptPath: FILE,
      workdir: "/会话起点",
      platform: "win32",
      exportedAt: new Date("2026-01-02T03:04:05.000Z"),
    });

    expect(payload.markdown).toContain("- 工作目录：`/会话起点`");
    expect(payload.markdown).not.toContain("- Git 分支：");
    expect(payload.markdown).not.toContain("- 创建时间：");
    expect(payload.jsonlBase64).toBe(Buffer.from(CONTENT).toString("base64"));
  });

  it("宿主没给平台时用本机平台兜底", async () => {
    serveFile(CONTENT);

    const payload = await exportTranscriptArchive({ transcriptPath: FILE });

    const manifest = JSON.parse(payload.manifestJson) as Record<
      string,
      unknown
    >;
    expect(manifest.platform).toBe(process.platform);
  });
});
