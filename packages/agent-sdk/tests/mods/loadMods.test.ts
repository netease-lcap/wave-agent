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

/**
 * 社区的布局：`hooks/hooks.json` 声明 `{ "modules": ["./register.tsx"] }`，入口
 * 路径相对 `hooks/` 目录（spec「兼容社区 mod」）。两种布局共用同一套校验与限额。
 */
describe("PluginLoader.loadMods 认社区的 hooks/hooks.json 布局", () => {
  /** 只放 hooks/ 布局：`mods/` 目录不存在。 */
  function mockHooksOnly(
    modules: unknown[],
    options: {
      sizes?: Record<string, number>;
      realpaths?: Record<string, string>;
    } = {},
  ): void {
    vi.mocked(fs.realpath).mockImplementation(async (target: unknown) => {
      const key = target as unknown as string;
      return options.realpaths?.[key] ?? key;
    });
    vi.mocked(fs.readdir).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ description: "x", modules }),
    );
    vi.mocked(fs.stat).mockImplementation(async (target: unknown) => {
      const key = target as unknown as string;
      return { size: options.sizes?.[key] ?? 16 } as unknown as Awaited<
        ReturnType<typeof fs.stat>
      >;
    });
  }

  it("modules 声明的入口被收进来，id 仍是插件名 + 文件名 stem", async () => {
    const entry = path.join(PLUGIN, "hooks", "register.ts");
    mockHooksOnly(["./register.ts"]);

    const mods = await PluginLoader.loadMods(PLUGIN, "burn-rate");

    expect(mods).toEqual([
      {
        id: "burn-rate:register",
        name: "register",
        path: entry,
        pluginRoot: PLUGIN,
      },
    ]);
  });

  it("两种布局指向同一个文件时只收一次", async () => {
    const entry = path.join(PLUGIN, "hooks", "register.ts");
    vi.mocked(fs.realpath).mockImplementation(async (target: unknown) => {
      const key = target as unknown as string;
      return key;
    });
    // `mods/` 目录里也有一个 register.ts，与 hooks.json 指的不是同一个文件
    // （不同目录），所以两个都在；这里专门验证「同一路径写两遍」只收一次。
    vi.mocked(fs.readdir).mockResolvedValue([
      dirent("other.ts"),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ modules: ["./register.ts", "./register.ts"] }),
    );
    vi.mocked(fs.stat).mockResolvedValue({ size: 16 } as unknown as Awaited<
      ReturnType<typeof fs.stat>
    >);

    const mods = await PluginLoader.loadMods(PLUGIN, "todo");

    expect(mods.map((mod) => mod.path)).toEqual([
      path.join(MODS_DIR, "other.ts"),
      entry,
    ]);
  });

  it("越出插件目录的 modules 入口被拒（与 mods/ 布局同一条纪律）", async () => {
    const outside = path.resolve("/elsewhere/evil.ts");
    mockHooksOnly(["/elsewhere/evil.ts"]);

    await expect(PluginLoader.loadMods(PLUGIN, "todo")).resolves.toEqual([]);
    expect(outside.startsWith(PLUGIN)).toBe(false);
  });

  it("非字符串的 modules 项被忽略；坏 JSON 不影响 mods/ 布局", async () => {
    const entry = path.join(PLUGIN, "hooks", "register.ts");
    mockHooksOnly(["./register.ts", 42, null]);
    const fromHooks = await PluginLoader.loadMods(PLUGIN, "todo");
    expect(fromHooks.map((mod) => mod.path)).toEqual([entry]);

    // hooks.json 不是合法 JSON ⇒ 这个布局没有 mod，但 mods/ 目录照旧加载。
    mockFiles(["a.ts"]);
    vi.mocked(fs.readFile).mockResolvedValue("{ not json");
    const fromMods = await PluginLoader.loadMods(PLUGIN, "todo");
    expect(fromMods.map((mod) => mod.id)).toEqual(["todo:a"]);
  });
});
