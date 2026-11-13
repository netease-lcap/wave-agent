import * as fs from "fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import { MOD_LIMITS } from "../../src/types/mods.js";

vi.mock("fs/promises");

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * `loadMods` 是 mod 的**加载期门禁**：只收四个扩展名、只收插件目录内的真文件、
 * 三个限额在这里先拦一道 —— 超限的文件根本不会进编译器（spec「限额」「加载
 * 纪律」）。
 */
const PLUGIN = path.resolve("/fake/plugin");
const MODS_DIR = path.join(PLUGIN, "mods");

function dirent(name: string) {
  return { name, isFile: () => true };
}

function mockFiles(
  names: string[],
  options: {
    sizes?: Record<string, number>;
    realpaths?: Record<string, string>;
  } = {},
): void {
  vi.mocked(fs.realpath).mockImplementation(async (target: unknown) => {
    const key = target as unknown as string;
    return options.realpaths?.[key] ?? key;
  });
  vi.mocked(fs.readdir).mockResolvedValue(
    names.map((name) => dirent(name)) as unknown as Awaited<
      ReturnType<typeof fs.readdir>
    >,
  );
  vi.mocked(fs.stat).mockImplementation(async (target: unknown) => {
    const key = target as unknown as string;
    return {
      size: options.sizes?.[key] ?? 16,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>;
  });
}

beforeEach(() => {
  vi.mocked(fs.realpath).mockReset();
  vi.mocked(fs.readdir).mockReset();
  vi.mocked(fs.stat).mockReset();
});

describe("PluginLoader.loadMods", () => {
  it("没有 mods 目录时返回空数组", async () => {
    vi.mocked(fs.realpath).mockResolvedValue(PLUGIN);
    vi.mocked(fs.readdir).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(PluginLoader.loadMods(PLUGIN, "todo")).resolves.toEqual([]);
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it("插件目录本身解析不出来时返回空数组", async () => {
    vi.mocked(fs.realpath).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(PluginLoader.loadMods(PLUGIN, "todo")).resolves.toEqual([]);
  });

  it("只收四个扩展名，id 由插件名 + 文件名 stem 构成，按名字排序", async () => {
    mockFiles(["b.tsx", "a.ts", "c.jsx", "d.js", "note.md", "noext"]);

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods.map((mod) => mod.id)).toEqual([
      "todo:a",
      "todo:b",
      "todo:c",
      "todo:d",
    ]);
    expect(mods[0]).toEqual({
      id: "todo:a",
      name: "a",
      path: path.join(MODS_DIR, "a.ts"),
      pluginRoot: PLUGIN,
    });
  });

  it("realpath 越出插件目录的文件被丢弃（符号链接不能变成可加载代码）", async () => {
    const outside = path.resolve("/elsewhere/evil.tsx");
    mockFiles(["good.tsx", "evil.tsx"], {
      realpaths: { [path.join(MODS_DIR, "evil.tsx")]: outside },
    });

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods.map((mod) => mod.id)).toEqual(["todo:good"]);
  });

  it("单文件超过 1 MiB 被丢弃", async () => {
    mockFiles(["big.tsx", "small.tsx"], {
      sizes: {
        [path.join(MODS_DIR, "big.tsx")]: MOD_LIMITS.fileBytes + 1,
      },
    });

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods.map((mod) => mod.id)).toEqual(["todo:small"]);
  });

  it("文件数超过 64 个时截断", async () => {
    mockFiles(
      Array.from(
        { length: MOD_LIMITS.fileCount + 5 },
        (_, i) => `m${String(i).padStart(3, "0")}.tsx`,
      ),
    );

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods).toHaveLength(MOD_LIMITS.fileCount);
  });

  it("总量超过 4 MiB 时停止累加", async () => {
    // 每个 1 MiB：第 5 个会把总量顶过 4 MiB，它自己与之后的一律不要。
    const names = ["a.tsx", "b.tsx", "c.tsx", "d.tsx", "e.tsx"];
    const sizes: Record<string, number> = {};
    for (const name of names) {
      sizes[path.join(MODS_DIR, name)] = 1024 * 1024;
    }
    mockFiles(names, { sizes });

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods.map((mod) => mod.id)).toEqual([
      "todo:a",
      "todo:b",
      "todo:c",
      "todo:d",
    ]);
  });

  it("单个文件 stat 失败时跳过它，其余照常", async () => {
    mockFiles(["ok.tsx", "gone.tsx"]);
    vi.mocked(fs.stat).mockImplementation(async (target: unknown) => {
      if ((target as unknown as string).endsWith("gone.tsx")) {
        throw new Error("ENOENT");
      }
      return { size: 16 } as unknown as Awaited<ReturnType<typeof fs.stat>>;
    });

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods.map((mod) => mod.id)).toEqual(["todo:ok"]);
  });

  it("目录里的子目录不算 mod 文件", async () => {
    vi.mocked(fs.realpath).mockResolvedValue(PLUGIN);
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "lib", isFile: () => false },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

    await expect(PluginLoader.loadMods(PLUGIN, "todo")).resolves.toEqual([]);
  });
});
