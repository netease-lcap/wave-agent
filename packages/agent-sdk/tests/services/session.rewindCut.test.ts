import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadRewindCut } from "@/services/session.js";
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

const compactLine = (id: string, summary: string) =>
  JSON.stringify({
    id,
    role: "assistant",
    timestamp: "2026-07-27T10:00:02.000Z",
    blocks: [{ type: "compact", content: summary }],
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

const ids = (messages: { id?: string }[]) => messages.map((m) => m.id);

describe("loadRewindCut()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  it("按消息位次切成留下 / 裁掉两段", async () => {
    mockTranscript([
      JSON.stringify({ type: "metadata", workdir: "/repo" }),
      userLine("u1", "第一问"),
      assistantLine("a1", "答"),
      userLine("u2", "第二问"),
      assistantLine("a2", "再答"),
    ]);

    const cut = await loadRewindCut(SESSION_ID, "/repo", 2);

    // 保留条目（metadata）不占位次：位次与检查点表、truncateSession 的行计数同义。
    expect(ids(cut.kept)).toEqual(["u1", "a1"]);
    expect(ids(cut.removed)).toEqual(["u2", "a2"]);
    expect(cut.threadMessageCount).toBe(4);
    expect(cut.firstUserText).toBe("第一问");
  });

  it("留下的那一段在最后一个压缩边界处折叠", async () => {
    mockTranscript([
      userLine("u1", "旧问"),
      assistantLine("a1", "旧答"),
      compactLine("c1", "摘要一"),
      userLine("u2", "新问"),
      assistantLine("a2", "新答"),
      compactLine("c2", "摘要二"),
      userLine("u3", "更晚的问"),
      assistantLine("a3", "更晚的答"),
    ]);

    const cut = await loadRewindCut(SESSION_ID, "/repo", 7);

    // 与 resume / compact 同款：内存里从最后一个压缩边界开始。
    expect(ids(cut.kept)).toEqual(["c2", "u3"]);
    expect(ids(cut.removed)).toEqual(["a3"]);
    // 首个用户输入取自**保留下来的前 index 条**（压缩前的也算）。
    expect(cut.firstUserText).toBe("旧问");
  });

  it("回滚点落在压缩边界之前时，留下的一段不含压缩块", async () => {
    mockTranscript([
      userLine("u1", "旧问"),
      compactLine("c1", "摘要"),
      userLine("u2", "新问"),
    ]);

    const cut = await loadRewindCut(SESSION_ID, "/repo", 1);

    // 压缩块在回滚点之后，所以它属于被裁掉的一段。
    expect(ids(cut.kept)).toEqual(["u1"]);
    expect(ids(cut.removed)).toEqual(["c1", "u2"]);
    expect(cut.firstUserText).toBe("旧问");
  });

  it("位次数的是消息行，不按 id 去重（与磁盘截断的计数一致）", async () => {
    // 老转录：同一个 id 在压缩点被重写过一次。
    mockTranscript([
      userLine("u1", "旧问"),
      userLine("u2", "重复出现的问"),
      compactLine("c1", "摘要"),
      userLine("u2", "重复出现的问"),
      userLine("u3", "更晚"),
    ]);

    const cut = await loadRewindCut(SESSION_ID, "/repo", 4);

    expect(ids(cut.kept)).toEqual(["c1", "u2"]);
    expect(ids(cut.removed)).toEqual(["u3"]);
    expect(cut.threadMessageCount).toBe(5);
  });

  it("index 超出线程条数时如实给出条数，由调用方判越界", async () => {
    mockTranscript([userLine("u1", "只有一条")]);

    const cut = await loadRewindCut(SESSION_ID, "/repo", 5);

    // 切分本身不判越界：条数照给，由 `truncateHistory` 对照它抛错。
    expect(ids(cut.kept)).toEqual(["u1"]);
    expect(cut.removed).toEqual([]);
    expect(cut.threadMessageCount).toBe(1);
  });

  it("会话文件不存在时返回空切分", async () => {
    vi.mocked(fs.access).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const cut = await loadRewindCut(SESSION_ID, "/repo", 0);

    expect(cut).toEqual({ kept: [], removed: [], threadMessageCount: 0 });
  });
});
