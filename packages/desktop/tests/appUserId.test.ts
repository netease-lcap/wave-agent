import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Windows toast 按 AUMID 归属：Electron 用 `app.setAppUserModelId()` 报的值去匹配
 * 安装器写进开始菜单快捷方式的那个（electron-builder 的 `build.appId`），两者不
 * 一致 toast 就静默发不出来 —— 不报错、不降级（spec desktop-notifications.md
 * 「边界情况」2）。两处字面量各写各的，没有任何类型或构建期约束把它们绑在一起，
 * 所以在这里钉：改了一处没改另一处，这条红。
 *
 * 读源码文本而不是 import `index.ts`：那个模块的顶层就是 `app.whenReady()` 一类
 * 的 Electron 副作用，也没有导出这个常量可拿。
 */
describe("Windows AUMID (spec desktop-notifications.md 边界情况 2)", () => {
  const packageRoot = path.resolve(__dirname, "..");
  const appId = (
    JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as {
      build?: { appId?: string };
    }
  ).build?.appId;

  it("app.setAppUserModelId in index.ts is electron-builder's build.appId, and is the only call", () => {
    const source = readFileSync(
      path.join(packageRoot, "src", "main", "index.ts"),
      "utf8",
    );
    const literals = [
      ...source.matchAll(/app\.setAppUserModelId\(\s*"([^"]+)"\s*\)/g),
    ].map((match) => match[1]);
    // 恰好一处、且是字面量：改成变量 / 模板字符串这条就红，逼着守卫一起改。
    expect(literals).toHaveLength(1);
    expect(appId).toEqual(expect.any(String));
    expect(literals[0]).toBe(appId);
  });
});
