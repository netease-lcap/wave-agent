import { describe, it, expect, vi, beforeEach } from "vitest";
import { findRewindTarget, loadRewindCheckpoints } from "@/services/session.js";
import { forEachLine } from "@/utils/fileUtils.js";
import { promises as fs } from "fs";

vi.mock("@/utils/fileUtils.js", () => ({ forEachLine: vi.fn() }));

vi.mock("@/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn().mockImplementation(function () {
    return {
      getProjectDirectory: vi.fn().mockResolvedValue({
        encodedPath: "/mock/project",
        originalPath: "/mock/workdir",
      }),
    };
  }),
}));

vi.mock("fs", () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    rename: vi.fn(),
    readdir: vi.fn(),
  },
}));

const SESSION_ID = "12345678-1234-4321-8765-123456789012";

const userLine = (id: string, content: string) =>
  JSON.stringify({
    id,
    role: "user",
    timestamp: "2026-07-27T10:00:00.000Z",
    blocks: [{ type: "text", content }],
  });

const assistantLine = (id: string, content: string) =>
  JSON.stringify({
    id,
    role: "assistant",
    timestamp: "2026-07-27T10:00:01.000Z",
    blocks: [{ type: "text", content }],
  });

/** 把 content 当成整份转录喂给逐行扫描（以换行结尾时最后一段空串不交出去）。 */
function mockTranscript(lines: string[], endsWithNewline = true) {
  const content = lines.join("\n") + (endsWithNewline ? "\n" : "");
  vi.mocked(forEachLine).mockImplementation(async (_filePath, onLine) => {
    const parts = content.split("\n");
    for (const line of parts.slice(0, -1)) await onLine(line);
    return { endsWithNewline };
  });
}

describe("loadRewindCheckpoints()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  it("投影出检查点：只留 id / 文本 / 在完整线程里的位置", async () => {
    mockTranscript([
      JSON.stringify({ type: "metadata", workdir: "/repo" }),
      userLine("u1", "第一问"),
      assistantLine("a1", "答"),
      userLine("u2", "第二问"),
    ]);

    const checkpoints = await loadRewindCheckpoints(SESSION_ID, "/repo");

    // 下标数的是「完整线程里的第几条消息」（metadata 这种保留条目不占位），
    // 因为它在调用方那一侧要喂给 `truncateHistory(index)`。
    expect(checkpoints).toEqual([
      { id: "u1", content: "第一问", index: 0 },
      { id: "u2", content: "第二问", index: 2 },
    ]);
  });

  it("压缩 append-only 的同 id 只留最后一次出现（连同它的位置）", async () => {
    mockTranscript([
      userLine("u1", "one"),
      assistantLine("a1", "hi"),
      userLine("u2", "two"),
      JSON.stringify({
        id: "c1",
        role: "assistant",
        timestamp: "2026-07-27T10:00:02.000Z",
        blocks: [{ type: "compact", content: "summary" }],
      }),
      userLine("u2", "two"),
      assistantLine("a2", "hi again"),
    ]);

    const checkpoints = await loadRewindCheckpoints(SESSION_ID, "/repo");

    expect(checkpoints).toEqual([
      { id: "u1", content: "one", index: 0 },
      // 用户看到的是折叠视图 = 最后一次出现
      { id: "u2", content: "two", index: 4 },
    ]);
  });

  it("后台通知与 hook 注入的消息不算检查点", async () => {
    mockTranscript([
      userLine("u1", "real input"),
      JSON.stringify({
        id: "n1",
        role: "user",
        timestamp: "2026-07-27T10:00:03.000Z",
        blocks: [
          {
            type: "task_notification",
            taskId: "t1",
            taskType: "shell",
            status: "completed",
            summary: "后台任务完成",
          },
        ],
      }),
      JSON.stringify({
        id: "h1",
        role: "user",
        isMeta: true,
        timestamp: "2026-07-27T10:00:04.000Z",
        blocks: [{ type: "text", content: "hook 输出" }],
      }),
    ]);

    const checkpoints = await loadRewindCheckpoints(SESSION_ID, "/repo");

    expect(checkpoints).toEqual([
      { id: "u1", content: "real input", index: 0 },
    ]);
  });

  it("没有 id 的用户消息不入选（回滚要靠 id 定位）", async () => {
    mockTranscript([
      JSON.stringify({
        role: "user",
        timestamp: "2026-07-27T10:00:00.000Z",
        blocks: [{ type: "text", content: "no id" }],
      }),
      userLine("u1", "有 id"),
    ]);

    const checkpoints = await loadRewindCheckpoints(SESSION_ID, "/repo");

    // 位置仍然是「完整线程里的第几条」：没 id 的那条也占位。
    expect(checkpoints).toEqual([{ id: "u1", content: "有 id", index: 1 }]);
  });

  it("容忍被中断的最后一行，中间坏行照旧报错", async () => {
    // 被中断的 append：文件不以换行结尾，最后一行是半截 JSON。
    mockTranscript([userLine("u1", "问"), '{"id":"u2","role":"us'], false);
    await expect(loadRewindCheckpoints(SESSION_ID, "/repo")).resolves.toEqual([
      { id: "u1", content: "问", index: 0 },
    ]);

    // 坏行后面还有能解析的行 ⇒ 真损坏。
    mockTranscript([userLine("u1", "问"), "{broken", userLine("u2", "问2")]);
    await expect(loadRewindCheckpoints(SESSION_ID, "/repo")).rejects.toThrow(
      "Invalid JSON at line 2",
    );
  });

  it("没有转录文件时返回空表", async () => {
    vi.mocked(fs.access).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(loadRewindCheckpoints(SESSION_ID, "/repo")).resolves.toEqual(
      [],
    );
    expect(forEachLine).not.toHaveBeenCalled();
  });
});

describe("findRewindTarget()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  it("给出位置与文本，同 id 取最后一次出现", async () => {
    mockTranscript([
      userLine("u1", "one"),
      assistantLine("a1", "hi"),
      userLine("u2", "two"),
      assistantLine("a2", "hi again"),
      userLine("u2", "two"),
    ]);

    await expect(findRewindTarget(SESSION_ID, "/repo", "u2")).resolves.toEqual({
      index: 4,
      content: "two",
    });
  });

  it("找不到这个 id 时返回 undefined", async () => {
    mockTranscript([userLine("u1", "one")]);

    await expect(
      findRewindTarget(SESSION_ID, "/repo", "missing"),
    ).resolves.toBeUndefined();
  });
});
