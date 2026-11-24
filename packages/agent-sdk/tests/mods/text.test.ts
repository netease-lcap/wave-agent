import { describe, it, expect } from "vitest";
import {
  toolResponseForModEvent,
  truncateForModEvent,
} from "../../src/mods/text.js";
import { MOD_LIMITS } from "../../src/types/mods.js";

/**
 * `classic.PostToolBatch` 的 `tool_response` 从「截断后的文本」改成「工具的
 * `data` 本身」之后，体积预算落在这里：对象要先量一遍 JSON 长度，超过
 * `$.ui.log` 那一份字符限额就退回截断文本。
 */
describe("toolResponseForModEvent", () => {
  it("装得下的对象原样给，插件读到的是结构化字段", () => {
    const data = { type: "create", filePath: "/a.ts", linesAdded: 3 };

    expect(toolResponseForModEvent(data, "File created")).toBe(data);
  });

  it("超出限额的对象退回截断文本，不把整份 data 递给每个插件", () => {
    const data = {
      content: "x".repeat(MOD_LIMITS.statusChars + 10),
      filePath: "/a.ts",
    };

    const response = toolResponseForModEvent(data, "x".repeat(20));

    // 序列化后的长度超了 ⇒ 与改动前完全一样的那份兜底。
    expect(response).toBe("x".repeat(20));
  });

  it("没有 data 时给 `{ content }`，与 PostToolUse 钩子的兜底同一份", () => {
    expect(toolResponseForModEvent(undefined, "done")).toEqual({
      content: "done",
    });
  });

  it("序列化不了（循环引用）时退回截断文本", () => {
    const data: Record<string, unknown> = { filePath: "/a.ts" };
    data.self = data;

    expect(toolResponseForModEvent(data, "done")).toBe("done");
  });

  it("文本本身按同一份限额截断", () => {
    const long = "y".repeat(MOD_LIMITS.statusChars + 5);
    const response = toolResponseForModEvent(long, long);

    expect(response).toBe(truncateForModEvent(long));
    expect(String(response).endsWith("…")).toBe(true);
  });
});
