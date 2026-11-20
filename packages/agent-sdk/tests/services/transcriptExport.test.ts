import { describe, it, expect, vi, beforeEach } from "vitest";
import { stat } from "fs/promises";
import {
  buildExportFilename,
  countTranscriptStats,
  describeTranscriptUnavailable,
  ensureTxtExtension,
  extractFirstPrompt,
  formatExportTimestamp,
  loadTranscriptForExport,
  sanitizeFilename,
  TranscriptUnavailableError,
} from "../../src/services/transcriptExport.js";
import { forEachLine } from "../../src/utils/fileUtils.js";
import type { Message } from "../../src/types/messaging.js";

/**
 * `/export` 的 SDK 半边：读整份转录、去重、统计、默认文件名。
 *
 * 这里钉住三条容易写偏的口径：
 *
 * - **导出要整条线程**，压缩边界之前的轮次也在里面（与恢复相反，那也是用户
 *   导出时最想看的东西）；
 * - **同 id 内容取最后一次**，老转录在压缩点重写了保留轮次；
 * - **读不到要分成两种原因**，`missing`（被 `cleanupPeriodDays` 清掉了）与
 *   `unreadable`（坏行 / 无权限）对用户是两句不同的话。
 */

vi.mock("fs/promises", () => ({ stat: vi.fn() }));
vi.mock("../../src/utils/fileUtils.js", () => ({ forEachLine: vi.fn() }));

const FILE = "/fake/session.jsonl";

/** 让 `forEachLine` 吐出一份「文件」：行数组按顺序喂，结尾按换行处理。 */
function serve(lines: string[]) {
  vi.mocked(forEachLine).mockImplementation(async (_filePath, onLine) => {
    for (const line of lines) await onLine(line);
    return { endsWithNewline: true };
  });
}

function messageLine(message: Message): string {
  return JSON.stringify(message);
}

function userMessage(id: string, text: string): Message {
  return {
    id,
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content: text }],
  };
}

/** 第一条 `metadata` 头 + 一条 `custom-title`：两者都不是消息。 */
const METADATA_LINE = JSON.stringify({
  type: "metadata",
  version: 1,
  sessionId: "s1",
  workdir: "/fake",
  createdAt: "2026-01-01T00:00:00.000Z",
});
const CUSTOM_TITLE_LINE = JSON.stringify({
  type: "custom-title",
  customTitle: "renamed",
});

beforeEach(() => {
  vi.mocked(stat).mockResolvedValue(
    {} as unknown as Awaited<ReturnType<typeof stat>>,
  );
  vi.mocked(forEachLine).mockReset();
});

describe("loadTranscriptForExport", () => {
  it("保留转录里的每条消息，跳过 metadata 与 custom-title 条目", async () => {
    serve([
      METADATA_LINE,
      "",
      messageLine(userMessage("m1", "你好")),
      CUSTOM_TITLE_LINE,
      messageLine({
        id: "m2",
        role: "assistant",
        timestamp: "2026-01-01T00:00:01.000Z",
        blocks: [{ type: "text", content: "收到" }],
      }),
    ]);

    const { messages, stats } = await loadTranscriptForExport(FILE);

    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(stats.messages).toBe(2);
  });

  it("不切压缩边界：压缩前的轮次也在导出里", async () => {
    serve([
      METADATA_LINE,
      messageLine(userMessage("m1", "第一轮")),
      messageLine({
        id: "m2",
        role: "assistant",
        timestamp: "2026-01-01T00:00:01.000Z",
        blocks: [{ type: "compact", content: "之前的摘要" }],
      }),
      messageLine(userMessage("m3", "压缩后的一轮")),
    ]);

    const { messages } = await loadTranscriptForExport(FILE);

    expect(messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("同 id 出现两次时内容取最后一次，位置留在首次出现处", async () => {
    serve([
      METADATA_LINE,
      messageLine(userMessage("m1", "旧版本")),
      messageLine(userMessage("m2", "另一条")),
      // 老转录在压缩点把保留轮次重写了一遍。
      messageLine(userMessage("m1", "新版本")),
    ]);

    const { messages } = await loadTranscriptForExport(FILE);

    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    const first = messages[0].blocks[0];
    expect(first.type === "text" ? first.content : "").toBe("新版本");
  });

  it("转录不存在时抛 missing，而不是当成空会话", async () => {
    vi.mocked(stat).mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );

    await expect(loadTranscriptForExport(FILE)).rejects.toMatchObject({
      name: "TranscriptUnavailableError",
      reason: "missing",
    });
    expect(forEachLine).not.toHaveBeenCalled();
  });

  it("其它读失败（无权限）抛 unreadable", async () => {
    vi.mocked(stat).mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );

    await expect(loadTranscriptForExport(FILE)).rejects.toMatchObject({
      reason: "unreadable",
    });
  });

  it("坏行（被中断的 append 之外）抛 unreadable 并带上原因", async () => {
    serve([messageLine(userMessage("m1", "好行")), "{ not json"]);

    const error = await loadTranscriptForExport(FILE).catch((cause) => cause);

    expect(error).toBeInstanceOf(TranscriptUnavailableError);
    expect(error.reason).toBe("unreadable");
    expect(error.message).toContain("Invalid JSON at line 2");
  });

  it("顺带带回转录字节数与最后一条 custom-title（桌面端靠它们定上限和标题）", async () => {
    vi.mocked(stat).mockResolvedValue({
      size: 1234,
    } as unknown as Awaited<ReturnType<typeof stat>>);
    serve([
      METADATA_LINE,
      messageLine(userMessage("m1", "你好")),
      CUSTOM_TITLE_LINE,
      JSON.stringify({ type: "custom-title", customTitle: "最后的名字" }),
    ]);

    await expect(loadTranscriptForExport(FILE)).resolves.toMatchObject({
      bytes: 1234,
      customTitle: "最后的名字",
    });
  });

  it("没人改过名时不带 customTitle 这个键", async () => {
    serve([METADATA_LINE, messageLine(userMessage("m1", "你好"))]);

    const exported = await loadTranscriptForExport(FILE);

    expect("customTitle" in exported).toBe(false);
  });
});

describe("describeTranscriptUnavailable", () => {
  it("「没了」要说清可能是 cleanupPeriodDays（默认 30 天）清的", () => {
    // 桌面端与 CLI 说的是同一句话：RPC 只带 message 过线，文案就得在 SDK 里定。
    expect(
      describeTranscriptUnavailable(
        new TranscriptUnavailableError(
          "missing",
          "Session transcript not found: x",
        ),
      ),
    ).toBe(
      "Session transcript not found: x. It may have been removed by cleanupPeriodDays (default 30 days).",
    );
  });

  it("其它读失败原样带上原因，不当成「已清理」", () => {
    expect(
      describeTranscriptUnavailable(
        new TranscriptUnavailableError(
          "unreadable",
          "EACCES: permission denied",
        ),
      ),
    ).toBe("Failed to export conversation: EACCES: permission denied");
  });
});

describe("countTranscriptStats", () => {
  it("数消息、工具调用与图片（含工具结果带的图）", () => {
    const messages: Message[] = [
      {
        id: "m1",
        role: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [
          { type: "text", content: "看图" },
          { type: "image", imageUrls: ["data:image/png;base64,AAA"] },
          {
            type: "tool",
            name: "Read",
            stage: "end",
            parameters: "{}",
            images: [{ data: "AAA", mediaType: "image/png" }],
          },
          { type: "tool", name: "Bash", stage: "end", parameters: "{}" },
        ],
      },
    ];

    expect(countTranscriptStats(messages)).toEqual({
      messages: 1,
      injectedMessages: 0,
      toolCalls: 2,
      images: 2,
    });
  });

  it("注入消息单独计数，不算进 messages、也不数它的工具与图片", () => {
    const messages: Message[] = [
      userMessage("m1", "真正说的话"),
      {
        ...userMessage("m2", "<system-reminder>…</system-reminder>"),
        isMeta: true,
        blocks: [
          { type: "text", content: "<system-reminder>…</system-reminder>" },
          { type: "image", imageUrls: ["data:image/png;base64,AAA"] },
          { type: "tool", name: "Bash", stage: "end", parameters: "{}" },
        ],
      },
      { ...userMessage("m3", "第二句"), isMeta: true },
    ];

    // 3 条里 2 条是注入 → 真实对话 1 条；注入消息里的工具/图片一律不进统计。
    expect(countTranscriptStats(messages)).toEqual({
      messages: 1,
      injectedMessages: 2,
      toolCalls: 0,
      images: 0,
    });
  });
});

describe("默认文件名", () => {
  it("时间戳是 yyyy-MM-dd-HHmmss（日期与时分秒之间一个连字符）", () => {
    // 与 Claude Code 的 `formatTimestamp` 逐字一致：`${y}-${m}-${d}-${hh}${mm}${ss}`。
    expect(formatExportTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "2026-01-02-030405",
    );
  });

  it("取首条非 meta 用户输入的首行，超过 50 字符截断加省略号", () => {
    const messages: Message[] = [
      {
        id: "meta",
        role: "user",
        isMeta: true,
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "元消息" }],
      },
      userMessage("m1", "  第一行标题  \n第二行"),
      userMessage("m2", "x".repeat(80)),
    ];

    // 首行尾随空白跟着留下（CC 也是先 trim 整段再取首行）；文件名那一步的
    // `sanitizeFilename` 会把它收成单个连字符，所以导出名不受影响。
    expect(extractFirstPrompt(messages)).toBe("第一行标题  ");
    expect(extractFirstPrompt([messages[2]])).toBe(`${"x".repeat(49)}…`);
    expect(extractFirstPrompt([])).toBe("");
  });

  it("净化只留 a-z0-9 与连字符，中文标题因此被清空", () => {
    expect(sanitizeFilename("Hello   World")).toBe("hello-world");
    expect(sanitizeFilename("--Fix: the  BUG!!--")).toBe("fix-the-bug");
    expect(sanitizeFilename("导出这个会话")).toBe("");
  });

  it("有可用的 slug 就用它，没有就回退 conversation-<timestamp>.txt", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(buildExportFilename([userMessage("m1", "Fix the bug")], date)).toBe(
      "2026-01-02-030405-fix-the-bug.txt",
    );
    expect(buildExportFilename([userMessage("m1", "导出会话")], date)).toBe(
      "conversation-2026-01-02-030405.txt",
    );
  });

  it("后缀一律强制成 .txt", () => {
    expect(ensureTxtExtension("chat.txt")).toBe("chat.txt");
    expect(ensureTxtExtension("chat.md")).toBe("chat.txt");
    expect(ensureTxtExtension("chat")).toBe("chat.txt");
    expect(ensureTxtExtension("2026-01-02030405-a.b.c")).toBe(
      "2026-01-02030405-a.b.txt",
    );
  });
});
