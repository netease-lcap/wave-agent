import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { compileMods, loaderFor } from "../../src/mods/compile.js";
import { getEsbuild } from "../../src/utils/esbuild.js";

/**
 * 编译器只做一件事：把 mod 源码转成沙箱能执行的 CJS。真 esbuild 在仓库里
 * （`esbuild` 是 SDK 依赖），所以这里跑真转译；拿不到 esbuild 的环境（运行时
 * 依赖还没装）整体跳过 —— 那条分支由 `modManager` 的错误态覆盖。
 */
const esbuild = getEsbuild();
const requireEsbuild = esbuild ? it : it.skip;

const ROOT = path.resolve("/fake/plugin/mods");

describe("loaderFor", () => {
  it.each([
    ["a.tsx", "tsx"],
    ["a.TS", "ts"],
    ["a.jsx", "jsx"],
    ["a.js", "js"],
    ["a.mjs", undefined],
    ["a", undefined],
  ])("%s → %s", (file, loader) => {
    expect(loaderFor(path.join(ROOT, file))).toBe(loader);
  });
});

describe("compileMods", () => {
  requireEsbuild("把 TSX 转成用 __wave.h 的 CJS", async () => {
    const file = path.join(ROOT, "panel.tsx");
    const outcomes = await compileMods(esbuild!, [
      {
        path: file,
        source: `
          type Props = { label: string };
          const show = (p: Props) => p;
          export function register() {
            return <Box gap={2}><Text>{show({ label: "hi" }).label}</Text></Box>;
          }
        `,
      },
    ]);

    const outcome = outcomes.get(file);
    expect(outcome?.error).toBeUndefined();
    expect(outcome?.code).toContain(`__wave.h(`);
    // esbuild 的 CJS 产物走 `__export(...)` + `module.exports = __toCommonJS(...)`。
    expect(outcome?.code).toContain("module.exports = __toCommonJS(");
    expect(outcome?.code).toContain("register");
    // 类型注解必须被剥掉，否则沙箱执行时会语法错误。
    expect(outcome?.code).not.toContain("type Props");
  });

  requireEsbuild("产物是 CJS（import 变 require）", async () => {
    const file = path.join(ROOT, "entry.ts");
    const outcomes = await compileMods(esbuild!, [
      { path: file, source: `export { register } from "./panel";` },
    ]);

    expect(outcomes.get(file)?.code).toContain(`require("./panel")`);
  });

  requireEsbuild(
    "单个文件语法错误不影响其它文件，错误带 file:line:col",
    async () => {
      const good = path.join(ROOT, "good.tsx");
      const bad = path.join(ROOT, "bad.tsx");
      const outcomes = await compileMods(esbuild!, [
        { path: good, source: `export const ok = 1;` },
        { path: bad, source: `export const x = <Box>;` },
      ]);

      expect(outcomes.get(good)?.code).toContain("const ok = 1;");
      expect(outcomes.get(bad)?.code).toBeUndefined();

      const error = outcomes.get(bad)?.error ?? "";
      expect(error).toContain(`${bad}:1:`);
      expect(error.length).toBeGreaterThan(0);
    },
  );

  it("不支持的文件类型逐个报错，不调用编译器", async () => {
    const file = path.join(ROOT, "notes.md");
    const outcomes = await compileMods(
      // 这个分支根本不会用到 esbuild，传个空壳即可。
      {} as Parameters<typeof compileMods>[0],
      [{ path: file, source: "# hi" }],
    );

    expect(outcomes.get(file)).toEqual({
      error: "不支持的文件类型：.md",
    });
  });
});
