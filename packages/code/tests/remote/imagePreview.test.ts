/**
 * 手机页取图的宿主侧（spec `remote/remote-web.md`「点消息里的图片路径看原
 * 图」）：三道闸门各自拒绝什么、放行时透出什么。
 *
 * 重点是**最后那道授权闸门**——判据是解码出来的真实容器，不是文件名的扩展名。
 * 一个 `/tmp/x.png` 若实际是符号链接指向文本文件，压缩阶梯会报 `unreadable`；
 * 一个真 SVG 名字叫 `.png` 也过不去。把这道闸门测住，名字就永远只是路由提示。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { statMock, readFileMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  readFileMock: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  stat: statMock,
  readFile: readFileMock,
}));

const { shrinkMock } = vi.hoisted(() => ({ shrinkMock: vi.fn() }));
vi.mock("wave-agent-sdk", () => ({ shrinkImageForTransport: shrinkMock }));

import {
  readImagePreview,
  IMAGE_PREVIEW_MAX_RAW_BYTES,
  IMAGE_PREVIEW_NOT_IMAGE,
  IMAGE_PREVIEW_TOO_LARGE,
  IMAGE_PREVIEW_CODEC_UNAVAILABLE,
  IMAGE_PREVIEW_READ_FAILED,
} from "../../src/remote/imagePreview.js";
import { REMOTE_MAX_FRAME_BYTES } from "../../src/remote/frameBudget.js";

const FILE = "/tmp/shots/before.png";

const okStat = (size = 1024) =>
  ({ isFile: () => true, size }) as unknown as Awaited<
    ReturnType<typeof import("node:fs/promises").stat>
  >;

const shrinkOk = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  dataUrl: "data:image/png;base64,AAAA",
  mime: "image/png",
  width: 800,
  height: 600,
  scaled: false,
  bytes: 3,
  sourceFormat: "png",
  ...overrides,
});

/** 取出抛出的错误码，省掉每个用例重复 `try/catch` 的样板。 */
async function codeOf(promise: Promise<unknown>): Promise<number | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: number }).code;
  }
  return undefined;
}

beforeEach(() => {
  statMock.mockReset();
  readFileMock.mockReset();
  shrinkMock.mockReset();
  readFileMock.mockResolvedValue(Buffer.from("bytes"));
  shrinkMock.mockResolvedValue(shrinkOk());
});

describe("readImagePreview — 读盘闸门", () => {
  it("空路径直接拒绝，不碰文件系统", async () => {
    expect(await codeOf(readImagePreview(""))).toBe(IMAGE_PREVIEW_NOT_IMAGE);
    expect(statMock).not.toHaveBeenCalled();
  });

  it("stat 失败（不存在 / 没权限）→ 读失败，不是「不是图片」", async () => {
    statMock.mockRejectedValueOnce(new Error("ENOENT: no such file"));
    expect(await codeOf(readImagePreview(FILE))).toBe(
      IMAGE_PREVIEW_READ_FAILED,
    );
  });

  it("目录也按读失败报（点到的是一棵目录树）", async () => {
    statMock.mockResolvedValueOnce({
      isFile: () => false,
      size: 0,
    } as unknown as Awaited<ReturnType<typeof statMock>>);
    expect(await codeOf(readImagePreview(FILE))).toBe(
      IMAGE_PREVIEW_READ_FAILED,
    );
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("超过 64 MB 不读进内存（视频改成 .png 名字也过不了这一关）", async () => {
    statMock.mockResolvedValueOnce(okStat(65 * 1024 * 1024));
    expect(await codeOf(readImagePreview(FILE))).toBe(IMAGE_PREVIEW_TOO_LARGE);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("readFile 失败 → 读失败", async () => {
    statMock.mockResolvedValueOnce(okStat());
    readFileMock.mockRejectedValueOnce(new Error("EACCES"));
    expect(await codeOf(readImagePreview(FILE))).toBe(
      IMAGE_PREVIEW_READ_FAILED,
    );
  });
});

describe("readImagePreview — 压缩阶梯的三种失败各有自己的话", () => {
  beforeEach(() => {
    statMock.mockResolvedValue(okStat());
  });

  it("没有图像处理库 → 让用户知道是这台机器缺能力", async () => {
    shrinkMock.mockResolvedValueOnce({ ok: false, reason: "no-codec" });
    expect(await codeOf(readImagePreview(FILE))).toBe(
      IMAGE_PREVIEW_CODEC_UNAVAILABLE,
    );
  });

  it("压到最后一档仍超预算 → 太大", async () => {
    shrinkMock.mockResolvedValueOnce({ ok: false, reason: "too-large" });
    expect(await codeOf(readImagePreview(FILE))).toBe(IMAGE_PREVIEW_TOO_LARGE);
  });

  it("解不出来 → 不是图片", async () => {
    shrinkMock.mockResolvedValueOnce({ ok: false, reason: "unreadable" });
    expect(await codeOf(readImagePreview(FILE))).toBe(IMAGE_PREVIEW_NOT_IMAGE);
  });
});

describe("readImagePreview — 授权闸门看的是解码出的容器", () => {
  beforeEach(() => {
    statMock.mockResolvedValue(okStat());
  });

  it("真 SVG 顶着 .png 名字也过不去", async () => {
    shrinkMock.mockResolvedValueOnce(shrinkOk({ sourceFormat: "svg" }));
    expect(await codeOf(readImagePreview(FILE))).toBe(IMAGE_PREVIEW_NOT_IMAGE);
  });

  it("容器未知（undefined）同样拒绝", async () => {
    shrinkMock.mockResolvedValueOnce(shrinkOk({ sourceFormat: undefined }));
    expect(await codeOf(readImagePreview(FILE))).toBe(IMAGE_PREVIEW_NOT_IMAGE);
  });

  it("gif 是白名单内的一档（动图首帧能看）", async () => {
    shrinkMock.mockResolvedValueOnce(
      shrinkOk({ sourceFormat: "gif", mime: "image/gif" }),
    );
    const result = await readImagePreview(FILE);
    expect(result.mime).toBe("image/gif");
  });
});

describe("readImagePreview — 放行时透出的字段", () => {
  it("把路径 / dataUrl / 尺寸 / 是否压过 一起交回去", async () => {
    statMock.mockResolvedValueOnce(okStat());
    shrinkMock.mockResolvedValueOnce(shrinkOk({ scaled: true }));

    await expect(readImagePreview(FILE)).resolves.toEqual({
      path: FILE,
      dataUrl: "data:image/png;base64,AAAA",
      mime: "image/png",
      width: 800,
      height: 600,
      scaled: true,
      bytes: 3,
    });
  });

  it("预算按单帧的 3/4 给（base64 膨胀 4/3），并且真的传给了压缩阶梯", async () => {
    statMock.mockResolvedValueOnce(okStat());
    await readImagePreview(FILE);

    expect(shrinkMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      IMAGE_PREVIEW_MAX_RAW_BYTES,
    );
    // 编码后的 dataUrl 必须落在一帧之内，否则中继会静默丢帧。
    expect(IMAGE_PREVIEW_MAX_RAW_BYTES * (4 / 3)).toBeLessThan(
      REMOTE_MAX_FRAME_BYTES,
    );
  });
});
