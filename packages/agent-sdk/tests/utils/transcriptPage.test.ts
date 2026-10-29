import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "fs/promises";
import {
  readTranscriptPage,
  transcriptLinesBackward,
} from "../../src/utils/transcriptPage.js";

/**
 * 转录读页是这套方案的核心原语：内存里的列表从最近一次压缩开始，
 * 更早的页到这里来读（spec ui/message-rendering-system.md「内存只装压缩后的上下文，更早的历史
 * 按页从转录取」）。
 *
 * 两条最容易写错的边界在这里钉住：
 *
 * - **首屏不许读整份文件**。改成「顺序流读完再切尾页」也能让所有断言变绿，只是
 *   几百 MB 的会话为了画第一屏要整份扫一遍——所以这里数读了多少字节。
 * - **行边界只能是换行字节**。按字符切块会把多字节 UTF-8 切坏，中文和 emoji 会在
 *   页面上变成乱码或整页解析失败。
 */

vi.mock("fs/promises", () => ({ open: vi.fn() }));

const FILE = "/fake/session.jsonl";

interface FakeFile {
  bytesRead: number;
  openCalls: number;
}

/** 把一份内容伪装成 `fs/promises` 的 FileHandle；`chunk` 只影响读的粒度。 */
function serve(content: string): FakeFile {
  const buffer = Buffer.from(content, "utf8");
  const stats: FakeFile = { bytesRead: 0, openCalls: 0 };
  vi.mocked(open).mockImplementation((async () => {
    stats.openCalls += 1;
    return {
      stat: async () => ({ size: buffer.length }),
      read: async (
        target: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        const bytesRead = Math.max(
          0,
          Math.min(length, buffer.length - position),
        );
        buffer.copy(target, offset, position, position + bytesRead);
        stats.bytesRead += bytesRead;
        return { bytesRead };
      },
      close: async () => {},
    };
  }) as unknown as typeof open);
  return stats;
}

function line(id: string): string {
  return JSON.stringify({
    id,
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content: id }],
  });
}

function transcript(ids: string[]): string {
  return ids.map(line).join("\n") + "\n";
}

/** 压缩点写进转录的样子：一条 assistant 消息，块类型是 `compact`。 */
function compactLine(id: string, content: string): string {
  return JSON.stringify({
    id,
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "compact", content }],
  });
}

const ids = (messages: { id?: string }[]): string[] =>
  messages.map((m) => m.id ?? "");

describe("readTranscriptPage", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  it("reads only the tail, never the whole file", async () => {
    const all = Array.from({ length: 400 }, (_, i) => `m${i}`);
    const stats = serve(transcript(all));

    const page = await readTranscriptPage(
      FILE,
      { limit: 2 },
      { chunkBytes: 64 },
    );

    expect(ids(page.messages)).toEqual(["m398", "m399"]);
    expect(page.hasMore).toBe(true);
    // 整份文件 ~40 KB；画一屏只该读到最后那两条附近（几十到几百字节）。
    expect(stats.bytesRead).toBeLessThan(4 * 1024);
  });

  it("says the history is exhausted when everything fits", async () => {
    serve(transcript(["m0", "m1", "m2"]));
    const page = await readTranscriptPage(FILE, { limit: 20 });
    expect(ids(page.messages)).toEqual(["m0", "m1", "m2"]);
    expect(page.hasMore).toBe(false);
  });

  it("skips reserved entries instead of rendering them as messages", async () => {
    serve(
      [
        JSON.stringify({ type: "metadata", workdir: "/repo" }),
        line("m0"),
        JSON.stringify({ type: "custom-title", customTitle: "重命名" }),
        line("m1"),
      ].join("\n") + "\n",
    );
    const page = await readTranscriptPage(FILE, { limit: 20 });
    expect(ids(page.messages)).toEqual(["m0", "m1"]);
  });

  it("returns the rows before the anchor, excluding it", async () => {
    serve(transcript(["m0", "m1", "m2", "m3"]));
    const page = await readTranscriptPage(FILE, { before: "m2", limit: 20 });
    expect(ids(page.messages)).toEqual(["m0", "m1"]);
    expect(page.hasMore).toBe(false);
  });

  it("stops at the anchor even when a limit would allow more", async () => {
    serve(transcript(["m0", "m1", "m2", "m3", "m4"]));
    const page = await readTranscriptPage(FILE, { before: "m3", limit: 2 });
    expect(ids(page.messages)).toEqual(["m1", "m2"]);
    expect(page.hasMore).toBe(true);
  });

  it("pages across a compaction boundary instead of stopping at it", async () => {
    // 压缩之后内存里只剩边界之后的尾部，边界之前的消息只有转录里有；锚点是消息
    // id 而不是下标，所以连翻几页必须能穿过摘要块一路翻到第一条
    // （spec ui/message-rendering-system.md 场景 8）。
    serve(
      [
        ...["m0", "m1", "m2"].map(line),
        compactLine("c1", "前情摘要"),
        ...["m3", "m4", "m5"].map(line),
      ].join("\n") + "\n",
    );

    const first = await readTranscriptPage(FILE, { before: "m3", limit: 2 });
    expect(ids(first.messages)).toEqual(["m2", "c1"]);
    expect(first.hasMore).toBe(true);
    // 摘要块本身就是一条消息，不能被当成保留条目跳掉——它就是压缩点在页面上的
    // 可见形态，缺了它这一段历史看起来就是「断」的。
    expect(first.messages[1].blocks).toEqual([
      { type: "compact", content: "前情摘要" },
    ]);

    const second = await readTranscriptPage(FILE, { before: "m2", limit: 2 });
    expect(ids(second.messages)).toEqual(["m0", "m1"]);
    expect(second.hasMore).toBe(false);
  });

  it("keeps every compaction block of a multi-compaction history in order", async () => {
    // 一条被反复压缩过的会话（实测那条 8038 行的转录有 46 个摘要块）里，翻回去
    // 要能一段段看到每个压缩点，而不是只剩最后一个。
    serve(
      [
        line("m0"),
        compactLine("c1", "第一次摘要"),
        line("m1"),
        compactLine("c2", "第二次摘要"),
        line("m2"),
      ].join("\n") + "\n",
    );

    let anchor: string | undefined;
    const collected: string[] = [];
    for (;;) {
      const page = await readTranscriptPage(
        FILE,
        anchor ? { before: anchor, limit: 3 } : { limit: 3 },
      );
      collected.unshift(...ids(page.messages));
      expect(page.anchorLost).toBeUndefined();
      const next = page.messages[0]?.id;
      if (!page.hasMore || !next) break;
      anchor = next;
    }

    expect(collected).toEqual(["m0", "c1", "m1", "c2", "m2"]);
  });

  it("reports a vanished before-anchor instead of pretending it is the start", async () => {
    // 锚点被 rewind 裁掉 / 从没写过盘：回 anchorLost 让调用方换一个更早的已知 id
    // 重试。直接判「到底」会让这段历史再也翻不出来（spec 场景 9）。
    serve(transcript(["m0", "m1"]));
    const page = await readTranscriptPage(FILE, { before: "gone", limit: 20 });
    expect(page).toEqual({ messages: [], hasMore: false, anchorLost: true });
  });

  it("answers only what came after the since-anchor", async () => {
    serve(transcript(["m0", "m1", "m2"]));
    const page = await readTranscriptPage(FILE, { since: "m1" });
    expect(ids(page.messages)).toEqual(["m2"]);
  });

  it("asks for a rebuild when the since-anchor is gone", async () => {
    serve(transcript(["m0", "m1"]));
    const page = await readTranscriptPage(FILE, { since: "gone" });
    expect(page).toEqual({ messages: [], hasMore: false, reset: true });
  });

  it("asks for a rebuild instead of a gapped page when the anchor is far behind", async () => {
    const all = Array.from({ length: 50 }, (_, i) => `m${i}`);
    serve(transcript(all));
    // 落后超过一页：补差会留下一个洞，整份重取尾页才对。
    const page = await readTranscriptPage(FILE, { since: "m0", limit: 5 });
    expect(page).toEqual({ messages: [], hasMore: false, reset: true });
  });

  it("keeps the LAST copy of a repeated id", async () => {
    // 压缩会把同一条消息重新写进展示流，老转录里同一个 id 可以出现两次：页面上
    // 只该有一份，且是读者已经看到的最新那份。
    serve(transcript(["a", "x", "b", "x", "c"]));
    const page = await readTranscriptPage(FILE, { limit: 20 });
    expect(ids(page.messages)).toEqual(["a", "b", "x", "c"]);
  });

  it("drops the half-written last line of an interrupted append", async () => {
    // 追加到一半被杀掉：最后一行没有换行，也不算一条消息。
    serve(transcript(["m0", "m1"]).concat('{"id":"m2","role":"user"'));
    const page = await readTranscriptPage(FILE, { limit: 20 });
    expect(ids(page.messages)).toEqual(["m0", "m1"]);
  });

  it("still throws on a corrupt line that is not the file's last one", async () => {
    serve(["{oops", line("m0")].join("\n") + "\n");
    await expect(readTranscriptPage(FILE, { limit: 20 })).rejects.toThrow();
  });

  it("answers an empty page when the transcript does not exist yet", async () => {
    vi.mocked(open).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    await expect(readTranscriptPage(FILE, { limit: 20 })).resolves.toEqual({
      messages: [],
      hasMore: false,
    });
    // 带 since 的调用方按「锚点不在了」重建，否则会一直等一个不存在的补差。
    await expect(readTranscriptPage(FILE, { since: "m1" })).resolves.toEqual({
      messages: [],
      hasMore: false,
      reset: true,
    });
  });

  it("stops at the byte budget but always keeps at least one message", async () => {
    const big = JSON.stringify({
      id: "big",
      role: "tool",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content: "x".repeat(4096) }],
    });
    serve([line("m0"), big, line("m1")].join("\n") + "\n");

    const page = await readTranscriptPage(
      FILE,
      { limit: 20 },
      { maxBytes: 512 },
    );
    expect(ids(page.messages)).toEqual(["m1"]);
    expect(page.hasMore).toBe(true);

    // 单条就超预算时也得返回它：否则调用方拿同一个锚点反复重问，永远翻不动。
    serve(big + "\n");
    const only = await readTranscriptPage(FILE, { limit: 20 }, { maxBytes: 1 });
    expect(ids(only.messages)).toEqual(["big"]);
  });

  it("splits lines on newline bytes, not on a character boundary", async () => {
    const content = JSON.stringify({
      id: "m0",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content: "中文🙂混排".repeat(20) }],
    });
    serve(content + "\n");
    // 3 字节的粒度一定会在某个多字节字符中间切开——按字符流实现就会读坏。
    const page = await readTranscriptPage(
      FILE,
      { limit: 5 },
      { chunkBytes: 3 },
    );
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].blocks).toEqual([
      { type: "text", content: "中文🙂混排".repeat(20) },
    ]);
  });
});

describe("transcriptLinesBackward", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  it("yields lines from the end, without the trailing newline's empty segment", async () => {
    serve("a\nb\nc\n");
    const lines: string[] = [];
    for await (const value of transcriptLinesBackward(FILE, 2)) {
      lines.push(value);
    }
    expect(lines).toEqual(["c", "b", "a"]);
  });

  it("yields a last line that has no newline after it", async () => {
    serve("a\nb");
    const lines: string[] = [];
    for await (const value of transcriptLinesBackward(FILE, 4)) {
      lines.push(value);
    }
    expect(lines).toEqual(["b", "a"]);
  });
});
