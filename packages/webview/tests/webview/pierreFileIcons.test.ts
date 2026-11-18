import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILE_ICON,
  FILE_ICON_GRADIENTS,
  FILE_ICON_PALETTE,
  FILE_ICON_SHAPES,
  fileIconFor,
} from "../../src/components/pierreFileIcons";

/**
 * 文件行类型图标的解析规则（spec desktop-file-panel.md「文件行按类型显示图标」
 * 场景 2-5）。纯函数，与 React 无关：断言的是「这个名字该配哪颗图标」。
 */
describe("fileIconFor：精确文件名优先于扩展名（场景 2）", () => {
  it("文件级条目压过扩展名条目", () => {
    // 同一个扩展名：带配置名前缀的那几个取专用图标，普通文件取语言图标。
    expect(fileIconFor("vite.config.ts")).toBe("vite");
    expect(fileIconFor("app.ts")).toBe("typescript");
    expect(fileIconFor("eslint.config.js")).toBe("eslint");
    expect(fileIconFor("app.js")).toBe("javascript");
    expect(fileIconFor("claude.md")).toBe("claude");
    expect(fileIconFor("notes.md")).toBe("markdown");
  });

  it("next.config.* 取 Next.js 图标（不是 TypeScript / JavaScript）", () => {
    expect(fileIconFor("next.config.ts")).toBe("nextjs");
    expect(fileIconFor("next.config.mjs")).toBe("nextjs");
    expect(fileIconFor("next.config.js")).toBe("nextjs");
  });

  it("比较对大小写不敏感（场景 2：README.md / Dockerfile）", () => {
    expect(fileIconFor("README.md")).toBe("markdown");
    expect(fileIconFor("Dockerfile")).toBe("docker");
    expect(fileIconFor("dockerfile")).toBe("docker");
  });
});

describe("fileIconFor：多点文件名逐段回退（场景 3）", () => {
  it("从第一个点起每段都试，命中即取", () => {
    // `.env.local`：先试 `env.local`（图标集里有这条），不是 `.local`。
    expect(fileIconFor(".env.local")).toBe("text");
    // `a.d.ts`：先试 `d.ts`（没有），再试 `ts`。
    expect(fileIconFor("a.d.ts")).toBe("typescript");
    // 首个点命中的隐藏文件。
    expect(fileIconFor(".gitignore")).toBe("git");
  });
});

describe("fileIconFor：落通用文件图标（场景 4-5）", () => {
  it("未知扩展名、无扩展名、未命中映射的点开头文件名", () => {
    expect(fileIconFor("app.unknownext")).toBe(DEFAULT_FILE_ICON);
    expect(fileIconFor("Makefile")).toBe(DEFAULT_FILE_ICON);
    expect(fileIconFor(".foo")).toBe(DEFAULT_FILE_ICON);
  });

  it("已确认的缺口：`.kt` / `.kts` 不在图标集里，落 default", () => {
    // 这条断言是**故意**钉住缺口：将来换/扩图标集补上 Kotlin 图形时它会红，
    // 提醒同步改这一行（spec 场景 5：不为一两个类型自绘图标）。
    expect(fileIconFor("Main.kt")).toBe("default");
    expect(fileIconFor("build.gradle.kts")).toBe(DEFAULT_FILE_ICON);
  });

  it("不借 Object.prototype 的键当图标（`constructor` 不是文件类型）", () => {
    expect(fileIconFor("constructor")).toBe(DEFAULT_FILE_ICON);
    expect(fileIconFor("foo.constructor")).toBe(DEFAULT_FILE_ICON);
  });
});

describe("图标数据本身", () => {
  it("任何解析结果都有对应的 path 表（渲染不会拿到 undefined）", () => {
    for (const name of [
      "app.ts",
      "app.tsx",
      "README.md",
      "a.json",
      "a.css",
      "a.png",
      "a.kt",
      "Makefile",
      "next.config.ts",
    ]) {
      const icon = fileIconFor(name);
      expect(FILE_ICON_SHAPES[icon].length).toBeGreaterThan(0);
    }
  });

  it("配色与渐变的每个键都有对应的 path 表（数据漂移时不会留下孤儿条目）", () => {
    for (const icon of [
      ...Object.keys(FILE_ICON_PALETTE),
      ...Object.keys(FILE_ICON_GRADIENTS),
    ]) {
      expect(
        FILE_ICON_SHAPES[icon as keyof typeof FILE_ICON_SHAPES],
      ).toBeDefined();
    }
  });

  it("nextjs 的斜线面引用自带渐变，且它没有配色（走 currentColor）", () => {
    const shapes = FILE_ICON_SHAPES.nextjs;
    expect(shapes.filter((s) => s.fill === "gradient")).toHaveLength(1);
    // 渐变两端颜色由 --fti-fill 给；nextjs 没有调色板条目 = 与上游一致的单色图标。
    expect(FILE_ICON_PALETTE.nextjs).toBeUndefined();
    expect(FILE_ICON_GRADIENTS.nextjs?.stops).toHaveLength(2);
  });

  it("配色用图标集自带的 [浅色, 深色] 一对；没有条目的回落到 currentColor", () => {
    expect(FILE_ICON_PALETTE.typescript).toEqual(["#1a85d4", "#69b1ff"]);
    expect(FILE_ICON_PALETTE.react).toEqual(["#1ca1c7", "#68cdf2"]);
    expect(FILE_ICON_PALETTE.default).toEqual(["#84848a", "#adadb1"]);
    // font / stylelint 在数据集里就是 currentColor，没有配色条目。
    expect(fileIconFor("a.ttf")).toBe("font");
    expect(FILE_ICON_PALETTE.font).toBeUndefined();
  });
});
