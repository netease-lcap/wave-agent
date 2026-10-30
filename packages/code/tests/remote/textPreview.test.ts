/**
 * 手机页读文本的宿主侧（spec `remote/remote-web.md`「点消息里的文件路径看内
 * 容」）：这道闸门只判「读出来的字节是不是文本」，**不看扩展名**。
 *
 * 三条要测住的性质：
 * - 含 NUL / 大面积解不出来 ⇒ 当二进制拒（这是入口不设白名单之后唯一的闸门）；
 * - 大文件只读开头 256 KiB，并如实说截断了（不是拒，也不是瞒着）；
 * - 截断落在多字节字符中间时不吐出半个字（退回最近的字符边界）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { statMock, openMock, readMock, closeMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  openMock: vi.fn(),
  readMock: vi.fn(),
  closeMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  stat: statMock,
  open: openMock,
}));

import {
  readTextPreview,
  TEXT_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_NOT_TEXT,
  TEXT_PREVIEW_READ_FAILED,
} from "../../src/remote/textPreview.js";

const FILE = "/tmp/build.log";

type StatResult = Awaited<ReturnType<typeof import("node:fs/promises").stat>>;

function serve(content: Buffer, size = content.length) {
  statMock.mockResolvedValue({
    isFile: () => true,
    size,
  } as unknown as StatResult);

  openMock.mockResolvedValue({ read: readMock, close: closeMock });

  readMock.mockImplementation(
    async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const chunk = content.subarray(position, position + length);
      chunk.copy(buffer, offset);
      return { bytesRead: chunk.length };
    },
  );
}

/** 断言 Promise 以某个 `TEXT_PREVIEW_*` 码收场。 */
async function expectCode(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
  statMock.mockReset();
  openMock.mockReset();
  readMock.mockReset();
  closeMock.mockReset();
  closeMock.mockResolvedValue(undefined);
});

describe("readTextPreview", () => {
  it("普通 UTF-8 文本原样回，未截断、无编码问题", async () => {
    serve(Buffer.from("hello\n世界\n", "utf8"));

    const result = await readTextPreview(FILE);

    expect(result.content).toBe("hello\n世界\n");
    expect(result.truncated).toBe(false);
    expect(result.encodingIssue).toBe(false);
    expect(result.bytes).toBe(Buffer.byteLength("hello\n世界\n"));
    expect(result.returnedBytes).toBe(result.bytes);
    expect(closeMock).toHaveBeenCalled();
  });

  it("空文件是一份空文本，不是错误", async () => {
    serve(Buffer.alloc(0));

    const result = await readTextPreview(FILE);

    expect(result.content).toBe("");
    expect(result.truncated).toBe(false);
  });

  it("含 NUL 字节 ⇒ 当二进制拒（入口不设扩展名白名单，这是唯一的闸门）", async () => {
    serve(Buffer.from([0x68, 0x69, 0x00, 0x01]));

    await expectCode(readTextPreview(FILE), TEXT_PREVIEW_NOT_TEXT);
    // 一个字节都不该出去。
    expect(openMock).toHaveBeenCalled();
  });

  it("把图片改名成 .log 也过不去：大面积解不出 UTF-8", async () => {
    // JPEG 的魔数：0xFF 0xD8 0xFF 在 UTF-8 里全是非法起始/续字节。
    serve(Buffer.from(Array.from({ length: 64 }, (_, i) => 0x80 + (i % 32))));

    await expectCode(readTextPreview(FILE), TEXT_PREVIEW_NOT_TEXT);
  });

  it("零星乱码照常显示，并标出编码问题（GBK 日志 ≠ 二进制）", async () => {
    const ascii = "build ok\n".repeat(50);
    // 中间夹一段 0x80 起头的非法序列：能解出大半，替换字符占比远低于一成。
    serve(Buffer.concat([Buffer.from(ascii), Buffer.from([0x80, 0x81])]));

    const result = await readTextPreview(FILE);

    expect(result.content).toContain("build ok");
    expect(result.encodingIssue).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("大文件只读开头 256 KiB，并如实说截断了", async () => {
    const content = Buffer.from("x".repeat(TEXT_PREVIEW_MAX_BYTES + 5000));
    serve(content);

    const result = await readTextPreview(FILE);

    expect(result.returnedBytes).toBe(TEXT_PREVIEW_MAX_BYTES);
    expect(result.content).toHaveLength(TEXT_PREVIEW_MAX_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(TEXT_PREVIEW_MAX_BYTES + 5000);
    // 只读一次，读的就是上限那么多字节。
    expect(readMock.mock.calls[0]![2]).toBe(TEXT_PREVIEW_MAX_BYTES);
  });

  it("截断落在多字节字符中间时退回字符边界（不吐半个字）", async () => {
    // 「中」是 3 字节；262144 % 3 = 1，所以按字节截断一定切在一个字符中间。
    const content = Buffer.from("中".repeat(90000), "utf8");
    serve(content);

    const result = await readTextPreview(FILE);

    expect(result.truncated).toBe(true);
    expect(result.content.endsWith("\uFFFD")).toBe(false);
    expect(result.content).toBe("中".repeat(result.content.length));
  });

  it("不存在 / 是目录 ⇒ 统一的读失败码", async () => {
    statMock.mockRejectedValue(new Error("ENOENT"));

    await expectCode(readTextPreview(FILE), TEXT_PREVIEW_READ_FAILED);
  });

  it("路径不是普通文件（目录 / 设备）⇒ 读失败，不去 open 它", async () => {
    statMock.mockResolvedValue({
      isFile: () => false,
      size: 0,
    } as unknown as StatResult);

    await expectCode(readTextPreview(FILE), TEXT_PREVIEW_READ_FAILED);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("空路径 ⇒ 读失败（不给宿主一个「读当前目录」的机会）", async () => {
    await expectCode(readTextPreview(""), TEXT_PREVIEW_READ_FAILED);
    expect(statMock).not.toHaveBeenCalled();
  });
});
