import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { atomicWriteFile } from "../../src/utils/atomicWrite.js";
import { ModFs } from "../../src/mods/files.js";
import { MOD_LIMITS } from "../../src/types/mods.js";

/**
 * `$.fs` 的宿主实现（spec「读写文件」）。
 *
 * 文件系统一律 mock：这一层要验的是**路径怎么解析、限额怎么拦、返回值什么
 * 形状**，不是 node 自己的读写。真读写由 runtime 层的集成测试与本机探针覆盖。
 */

vi.mock("node:fs", () => ({
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    lstat: vi.fn(),
  },
}));
vi.mock("../../src/utils/atomicWrite.js", () => ({
  atomicWriteFile: vi.fn(async () => {}),
}));

/** 会话当前工作目录（会随 `cd` 动），相对路径以它为基准。 */
const CWD = path.resolve("/fake/project");

function api(cwd = CWD) {
  return new ModFs(() => cwd);
}

/** 一个最小可用的 `lstat` 返回值。 */
function dirent(options: {
  dir?: boolean;
  link?: boolean;
  size?: number;
}): Awaited<ReturnType<typeof fsp.lstat>> {
  return {
    isDirectory: () => options.dir === true,
    isSymbolicLink: () => options.link === true,
    size: options.size ?? 0,
  } as unknown as Awaited<ReturnType<typeof fsp.lstat>>;
}

describe("ModFs.read", () => {
  it("相对路径按会话当前工作目录解析，返回文本", async () => {
    vi.mocked(fsp.stat).mockResolvedValue(
      dirent({ size: 5 }) as unknown as Awaited<ReturnType<typeof fsp.stat>>,
    );
    vi.mocked(fsp.readFile).mockResolvedValue(
      Buffer.from("hello") as unknown as Awaited<
        ReturnType<typeof fsp.readFile>
      >,
    );

    await expect(api().read("notes/today.md")).resolves.toBe("hello");
    expect(fsp.stat).toHaveBeenCalledWith(path.resolve(CWD, "notes/today.md"));
  });

  it("绝对路径原样使用", async () => {
    vi.mocked(fsp.stat).mockResolvedValue(
      dirent({ size: 3 }) as unknown as Awaited<ReturnType<typeof fsp.stat>>,
    );
    vi.mocked(fsp.readFile).mockResolvedValue(
      Buffer.from("abc") as unknown as Awaited<ReturnType<typeof fsp.readFile>>,
    );

    const absolute = path.resolve("/elsewhere/a.txt");
    await api().read(absolute);
    expect(fsp.stat).toHaveBeenCalledWith(absolute);
  });

  it("as: bytes 返回 base64", async () => {
    vi.mocked(fsp.stat).mockResolvedValue(
      dirent({ size: 2 }) as unknown as Awaited<ReturnType<typeof fsp.stat>>,
    );
    vi.mocked(fsp.readFile).mockResolvedValue(
      Buffer.from([0xff, 0x00]) as unknown as Awaited<
        ReturnType<typeof fsp.readFile>
      >,
    );

    await expect(api().read("a.bin", { as: "bytes" })).resolves.toEqual({
      base64: Buffer.from([0xff, 0x00]).toString("base64"),
    });
  });

  it("文件超过上限时不读进来，直接报错", async () => {
    vi.mocked(fsp.stat).mockResolvedValue(
      dirent({ size: MOD_LIMITS.fsFileBytes + 1 }) as unknown as Awaited<
        ReturnType<typeof fsp.stat>
      >,
    );

    await expect(api().read("huge.log")).rejects.toThrow(/超过 \d+ 字节/);
    expect(fsp.readFile).not.toHaveBeenCalled();
  });

  it("as 只接受 text / bytes", async () => {
    await expect(api().read("a.txt", { as: "xml" as "text" })).rejects.toThrow(
      /as 只能是/,
    );
  });

  it("路径不是非空字符串就报错", async () => {
    await expect(api().read("")).rejects.toThrow(/非空路径字符串/);
    await expect(api().read(1)).rejects.toThrow(/非空路径字符串/);
  });
});

describe("ModFs.write", () => {
  it("写进解析后的路径，父目录按需创建，走原子写", async () => {
    await api().write("out/report.json", "{}");

    expect(fsp.mkdir).toHaveBeenCalledWith(path.resolve(CWD, "out"), {
      recursive: true,
    });
    expect(atomicWriteFile).toHaveBeenCalledWith(
      path.resolve(CWD, "out/report.json"),
      "{}",
    );
  });

  it("内容超过上限就报错，也不落盘", async () => {
    const tooBig = "a".repeat(MOD_LIMITS.fsFileBytes + 1);

    await expect(api().write("big.txt", tooBig)).rejects.toThrow(/超过/);
    expect(atomicWriteFile).not.toHaveBeenCalled();
  });

  it("内容不是字符串就报错", async () => {
    await expect(api().write("a.txt", 1)).rejects.toThrow(/必须是字符串/);
  });
});

describe("ModFs.list / stat / exists", () => {
  it("list 返回一层的条目，标出目录与符号链接，按名字排序", async () => {
    vi.mocked(fsp.readdir).mockResolvedValue([
      "b.md",
      "a",
      "link",
    ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>);
    vi.mocked(fsp.lstat).mockImplementation((async (at: string) => {
      const name = path.basename(at);
      if (name === "a") return dirent({ dir: true });
      if (name === "link") return dirent({ link: true, size: 4 });
      return dirent({ size: 7 });
    }) as unknown as typeof fsp.lstat);

    await expect(api().list(".")).resolves.toEqual([
      { name: "a", kind: "dir", size: 0, isLink: false },
      { name: "b.md", kind: "file", size: 7, isLink: false },
      { name: "link", kind: "file", size: 4, isLink: true },
    ]);
  });

  it("stat 只报这一条本身（不跟随符号链接）", async () => {
    vi.mocked(fsp.lstat).mockResolvedValue(
      dirent({ link: true, size: 4 }) as unknown as Awaited<
        ReturnType<typeof fsp.lstat>
      >,
    );

    await expect(api().stat("link")).resolves.toEqual({
      kind: "file",
      size: 4,
      isLink: true,
    });
  });

  it("exists 对不存在的路径返回 false，不抛错", async () => {
    vi.mocked(fsp.lstat).mockRejectedValue(
      Object.assign(new Error("gone"), { code: "ENOENT" }),
    );

    await expect(api().exists("nope.txt")).resolves.toBe(false);
  });
});
