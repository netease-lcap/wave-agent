import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 设置页在手机上的单列布局（spec ui/remote-control.md「Web 端也能改设置」场景 4）。
 *
 * 远控网页是这一页唯一会跑在手机浏览器里的宿主：390px 下「240px 左导航 + 内容」的
 * 两列只剩不到 150px 给内容，什么控件都放不下。修法是 ≤760px 换单列（返回在上、
 * 导航压成一行可横向滑动的胶囊、内容在下占满宽度、输入/按钮占满一行）。
 *
 * jsdom 没有布局引擎，媒体查询的结果在单元测试里看不到，所以从**样式表结构**上钉
 * 三条——它们分别对应三个会悄悄坏掉的写法：
 *
 * 1. 单列规则确实存在，且落在 `max-width: 760px` 这个断点内；
 * 2. 断点内的每条规则都以 `.settings-` 开头（手机上的会话区共用同一张样式表，
 *    一条漏出去的通配规则会把聊天页一起改掉）；
 * 3. 断点外的既有规则一个都没被改写：`.settings-layout` 仍是两列、导航仍是竖排、
 *    导航项仍是方角——桌面端与 IDE 宿主的设置页不该因为这次移动适配动一行。
 *
 * 真机上的观感（390px / 768px 两档）仍要人眼过；这里钉的是「就算退化，也不会
 * 退化成另一种布局」。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const WEBVIEW = resolve(HERE, "../..");
const read = (rel: string) => fs.readFileSync(resolve(WEBVIEW, rel), "utf-8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Block {
  /** `@media> .settings-layout` for a nested rule, plain selector at top level. */
  sel: string;
  body: string;
}

const MOBILE_QUERY = "@media (max-width: 760px)";

/**
 * 把样式表拆成 `selector { body }` 块，一层 `@media` 摊平（子规则前缀
 * `@media> `）。分组选择器（`.a,\n.b { … }`）原样保留成一条规则，由
 * `selectorsOf` 再拆开。
 */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (ch === "}") {
      const sel = stack.pop() as string;
      out.push({
        sel: stack.length > 0 ? `@media> ${sel}` : sel,
        body: buf,
      });
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

/** A rule's selector list, one entry per comma-separated part. */
const selectorsOf = (sel: string) =>
  sel
    .replace(/^@media> /, "")
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "));

const css = strip(read("src/styles/SettingsPage.css"));
const all = blocks(css);

/** 断点内的规则，选择器已拆成单条（分组选择器命中其一即可查）。 */
const mobile = all
  .filter((block) => block.sel.startsWith("@media> "))
  .flatMap((block) =>
    selectorsOf(block.sel).map((sel) => ({ sel, body: block.body })),
  );

/** 命中的第一条（不带媒体前缀的）普通规则。 */
function base(selector: string): Block | undefined {
  return all.find(
    (block) =>
      !block.sel.startsWith("@") && selectorsOf(block.sel).includes(selector),
  );
}

function mobileRule(selector: string): Block | undefined {
  return mobile.find((block) => block.sel === selector);
}

/** 某条规则里某属性的值（同一条规则里最后一次声明为准，与浏览器一致）。 */
function declared(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g");
  let value: string | null = null;
  for (const match of body.matchAll(pattern)) value = match[1].trim();
  return value;
}

describe("the settings page's phone layout", () => {
  it("switches to one column below the 760px breakpoint", () => {
    // 断点值本身也钉住：768px 要落在它上方（平板仍是两列），390px 要落在下方。
    expect(css).toContain(`${MOBILE_QUERY} {`);

    const layout = mobileRule(".settings-layout");
    expect(
      layout,
      "no .settings-layout rule inside the breakpoint",
    ).toBeDefined();
    // 单列：内容那一列独占，左导航退成上面单独一行（返回 + 一行胶囊）。
    expect(declared(layout!.body, "grid-template-columns")).toBe(
      "minmax(0, 1fr)",
    );
    expect(declared(layout!.body, "grid-template-rows")).toContain("minmax(0");
  });

  it("turns the navigation into a horizontally scrolling chip row", () => {
    const nav = mobileRule(".settings-navigation");
    expect(nav).toBeDefined();
    expect(declared(nav!.body, "flex-direction")).toBe("row");
    expect(declared(nav!.body, "overflow-x")).toBe("auto");
    // 横向滑动时别把整页的手势抢走（浏览器回退手势在 iOS 上优先）。
    expect(declared(nav!.body, "overscroll-behavior-x")).toBe("contain");

    const item = mobileRule(".settings-nav-item");
    expect(item).toBeDefined();
    // 一行里平铺的胶囊：不换行、不缩、圆角、手指点得到的高度。
    expect(declared(item!.body, "white-space")).toBe("nowrap");
    expect(declared(item!.body, "flex")).toContain("0 0 auto");
    expect(declared(item!.body, "border-radius")).toBe("999px");
    expect(declared(item!.body, "height")).toBe("36px");

    // 分组标题在单列里没有位置（否则每段都要占一行，导航会长成一屏高）。
    expect(
      declared(mobileRule(".settings-nav-group h2")!.body, "display"),
    ).toBe("none");
    expect(declared(mobileRule(".settings-nav-group")!.body, "display")).toBe(
      "contents",
    );
  });

  it("narrows the content padding and gives controls the full width", () => {
    // 760px 以下内容区不能再用桌面的 40px 边距：390px 里那是五分之一的屏宽。
    const view = mobileRule(".settings-view");
    expect(view).toBeDefined();
    expect(declared(view!.body, "padding")).toBe("20px 16px 48px");
    expect(declared(view!.body, "width")).toBe("100%");

    // 文字标签在上、控件在下（桌面上是左右两栏）。
    expect(declared(mobileRule(".settings-row")!.body, "flex-direction")).toBe(
      "column",
    );

    for (const selector of [".settings-control", ".settings-number-control"]) {
      expect(declared(mobileRule(selector)!.body, "width")).toBe("100%");
    }

    // 控件本身占满一行，并把点击目标抬到 40px（与远控页其余按钮同一档）。
    for (const selector of [
      ".settings-number-input",
      ".settings-text-input",
      ".settings-select",
      ".settings-select-trigger",
    ]) {
      const rule = mobileRule(selector);
      expect(rule, `no ${selector} rule inside the breakpoint`).toBeDefined();
      expect(declared(rule!.body, "width")).toBe("100%");
      expect(declared(rule!.body, "min-height")).toBe("40px");
    }

    // 保存按钮整颗占一行；动作区竖排（桌面上是右对齐的一行）。
    expect(
      declared(mobileRule(".settings-actions")!.body, "flex-direction"),
    ).toBe("column");
    expect(declared(mobileRule(".settings-save-btn")!.body, "width")).toBe(
      "100%",
    );
    expect(declared(mobileRule(".settings-save-btn")!.body, "height")).toBe(
      "40px",
    );
  });

  it("keeps every breakpoint rule scoped to the settings page", () => {
    // 同一张样式表也服务会话区：断点里漏一条通配规则，手机上的聊天页会跟着变。
    expect(mobile.length).toBeGreaterThan(0);
    for (const rule of mobile) {
      expect(
        rule.sel.startsWith(".settings-"),
        `breakpoint rule escapes the settings page: ${rule.sel}`,
      ).toBe(true);
    }
  });

  it("leaves the desktop and IDE layout untouched above the breakpoint", () => {
    // 断点外仍是两列（左导航固定宽度 + 弹性内容），宽度由
    // --cc-settings-navigation-width 给（240px）。
    const layout = base(".settings-layout");
    expect(layout, "no base .settings-layout rule").toBeDefined();
    expect(declared(layout!.body, "grid-template-columns")).toContain(
      "var(--cc-settings-navigation-width)",
    );
    // 竖排导航、方角导航项、桌面上的内容边距：一个都没改。
    expect(declared(base(".settings-navigation")!.body, "flex-direction")).toBe(
      "column",
    );
    expect(
      declared(base(".settings-navigation")!.body, "overflow-x"),
    ).toBeNull();
    // 桌面上的导航项是 6px 圆角的方卡，不是手机那一行里的胶囊。
    expect(declared(base(".settings-nav-item")!.body, "border-radius")).toBe(
      "6px",
    );
    expect(declared(base(".settings-view")!.body, "padding")).toBe(
      "40px 24px 72px",
    );
    expect(
      declared(base(".settings-actions")!.body, "flex-direction"),
    ).toBeNull();
  });
});
