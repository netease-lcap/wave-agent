import { describe, it, expect, vi, beforeEach } from "vitest";
import { stat } from "fs/promises";
import type { Message } from "../../src/types/messaging.js";
import { forEachLine } from "../../src/utils/fileUtils.js";
import {
  clearTranscriptOutlineCache,
  outlineEntryText,
  readTranscriptOutline,
} from "../../src/utils/transcriptIndex.js";
import { OUTLINE_TEXT_LIMIT } from "../../src/constants/messageWindow.js";

/**
 * 大纲索引是「整条会话有哪些问句」的唯一来源（spec ui/transcript-outline.md
 * 场景 16）。三条判据在这里钉住：
 *
 * - **只有带文本的用户消息进索引**。助手消息、`isMeta` 注入消息、纯任务通知都
 *   不是刻度——判据与吸顶条的 `stickyAnchorText` 同源。
 * - **同一份转录不重复解析**。索引失效判据是 (size, mtimeMs, ino)：这三个值没变
 *   就说明文件没动过，再扫一遍只是白花时间（长会话一次几十毫秒）。
 * - **解析失败要退让，不是抛给页面**。文件被删、读盘抖动都按「没有索引」处理，
 *   页面据此退回到已加载的那一份（场景 20）。
 */

vi.mock("fs/promises", () => ({ stat: vi.fn() }));
vi.mock("../../src/utils/fileUtils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/fileUtils.js")>();
  return { ...actual, forEachLine: vi.fn() };
});

const FILE = "/fake/session.jsonl";

function mockStat(size: number, mtimeMs = 1, ino = 7) {
  vi.mocked(stat).mockResolvedValue({
    size,
    mtimeMs,
    ino,
  } as unknown as Awaited<ReturnType<typeof stat>>);
}

/** 与 `TranscriptOutlineEntry` 无关的行规则：文件尾的换行不产生一条空行。 */
function mockFileContent(content: string) {
  vi.mocked(forEachLine).mockImplementation(async (_filePath, onLine) => {
    const endsWithNewline = content.length === 0 || content.endsWith("\n");
    const lines = content.split(/\r?\n/);
    for (const line of endsWithNewline ? lines.slice(0, -1) : lines) {
      await onLine(line);
    }
    return { endsWithNewline };
  });
}

function messageLine(
  id: string,
  content: string,
  overrides: Partial<Message> = {},
): string {
  return JSON.stringify({
    id,
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content }],
    ...overrides,
  });
}

const assistantLine = (id: string) =>
  JSON.stringify({
    id,
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content: "回答" }],
  });

const transcript = (lines: string[]) => lines.join("\n") + "\n";

describe("readTranscriptOutline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTranscriptOutlineCache();
  });

  it("keeps only user messages that carry text, in file order", async () => {
    mockStat(1024);
    mockFileContent(
      transcript([
        messageLine("u1", "第一个问题"),
        assistantLine("a1"),
        messageLine("u2", "第二个问题"),
        // 注入型提示（规则提醒、钩子上下文）：不是用户问的，不该成为刻度。
        messageLine("meta1", "规则提醒", { isMeta: true }),
        // 纯任务通知：没有 text 块。
        JSON.stringify({
          id: "notice1",
          role: "user",
          timestamp: "2026-01-01T00:00:00.000Z",
          blocks: [{ type: "notice", content: "任务完成" }],
        }),
      ]),
    );

    const items = await readTranscriptOutline(FILE);

    expect(items).toEqual([
      { id: "u1", text: "第一个问题" },
      { id: "u2", text: "第二个问题" },
    ]);
  });

  it("truncates the question to the shared limit", async () => {
    mockStat(1024);
    mockFileContent(transcript([messageLine("u1", "长".repeat(1000))]));

    const items = await readTranscriptOutline(FILE);

    expect(items[0].text).toHaveLength(OUTLINE_TEXT_LIMIT);
  });

  it("keeps the last occurrence when an id repeats across a compaction point", async () => {
    // 老转录会在压缩点重复写入保留轮次：页面上只该有一个刻度，口径与
    // `transcriptPage` 的游标一致（保留最后一次出现的文本）。
    mockStat(1024);
    mockFileContent(
      transcript([
        messageLine("u1", "旧文本"),
        messageLine("u1", "新文本"),
        messageLine("u2", "第二个"),
      ]),
    );

    const items = await readTranscriptOutline(FILE);

    expect(items).toEqual([
      { id: "u1", text: "新文本" },
      { id: "u2", text: "第二个" },
    ]);
  });

  it("returns the cached index while the transcript is untouched", async () => {
    mockStat(1024, 111, 22);
    mockFileContent(transcript([messageLine("u1", "问题")]));

    const first = await readTranscriptOutline(FILE);
    const second = await readTranscriptOutline(FILE);

    expect(second).toEqual(first);
    // 只扫过一次：宿主反复打开会话不该重复全量解析（场景 16）。
    expect(vi.mocked(forEachLine)).toHaveBeenCalledTimes(1);
  });

  it("rescans once the file's size or mtime moves", async () => {
    mockStat(1024, 111, 22);
    mockFileContent(transcript([messageLine("u1", "问题")]));
    await readTranscriptOutline(FILE);

    // append 之后 size 变了：必须重扫，否则新问句永远不出现在刻度里（场景 19）。
    mockStat(2048, 222, 22);
    await readTranscriptOutline(FILE);

    expect(vi.mocked(forEachLine)).toHaveBeenCalledTimes(2);
  });

  it("treats a missing transcript as an empty index, not an error", async () => {
    vi.mocked(stat).mockRejectedValue(
      Object.assign(new Error("gone"), { code: "ENOENT" }),
    );

    await expect(readTranscriptOutline(FILE)).resolves.toEqual([]);
    expect(vi.mocked(forEachLine)).not.toHaveBeenCalled();
  });
});

describe("outlineEntryText", () => {
  it("agrees with the sticky bar's predicate", () => {
    const base = { id: "u1", timestamp: "2026-01-01T00:00:00.000Z" };

    expect(
      outlineEntryText({ ...base, role: "user", blocks: [] } as Message),
    ).toBe("");
    expect(
      outlineEntryText({
        ...base,
        role: "user",
        isMeta: true,
        blocks: [{ type: "text", content: "注入" }],
      } as Message),
    ).toBe("");
    expect(
      outlineEntryText({
        ...base,
        role: "assistant",
        blocks: [{ type: "text", content: "回答" }],
      } as Message),
    ).toBe("");
    expect(
      outlineEntryText({
        ...base,
        role: "user",
        blocks: [
          { type: "text", content: "前半" },
          { type: "text", content: "后半" },
        ],
      } as Message),
    ).toBe("前半 后半");
  });
});
