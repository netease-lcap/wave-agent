import { describe, expect, it } from "vitest";
import {
  USER_PREFERENCE_LABELS,
  describeUserPreferencePatch,
} from "../../src/constants/userPreferences.js";

/**
 * 写盘失败提示的键名翻译（spec core/agent-config.md「设置页控件的保存时机」
 * 与 desktop/desktop-settings.md「设置页反馈语义」）：失败文案是
 * 「设置未写入「<键名>」：<原因>」，键名必须是人话，不能漏出 `contextLength`。
 */
describe("describeUserPreferencePatch", () => {
  it("把单个偏好键翻成设置页里那一行的标题", () => {
    expect(describeUserPreferencePatch({ contextLength: 128 })).toBe(
      "上下文长度",
    );
    expect(describeUserPreferencePatch({ enableKnowledgeBase: false })).toBe(
      "企业知识库",
    );
  });

  it("多个键（老版本 webview 的整体保存）按顺序用「、」连起来", () => {
    expect(
      describeUserPreferencePatch({
        language: "en-US",
        autoMemoryEnabled: true,
      }),
    ).toBe("AI 回复语言、开启自动记忆");
  });

  it("显式 undefined 的键不算「写过」，不参与文案", () => {
    expect(
      describeUserPreferencePatch({ language: undefined, contextLength: 200 }),
    ).toBe("上下文长度");
  });

  it("空载荷回落到「设置」，不回退成空标签", () => {
    expect(describeUserPreferencePatch({})).toBe("设置");
  });

  it("未知键（新 webview + 旧宿主）宁可显示键名，也不显示空", () => {
    expect(describeUserPreferencePatch({ brandNewKey: 1 })).toBe("brandNewKey");
  });

  it("标签表覆盖全部用户偏好键（设置页每行都有名字）", () => {
    // 与 webview 的行标题逐字一致；漏一个键，失败提示就会漏出键名原文。
    expect(USER_PREFERENCE_LABELS).toEqual({
      language: "AI 回复语言",
      contextLength: "上下文长度",
      autoMemoryEnabled: "开启自动记忆",
      autoMemoryFrequency: "触发记忆提取会话轮次",
      completionModel: "补全模型",
      completionEnabled: "代码补全",
      nextEditEnabled: "下一步编辑建议",
      enableKnowledgeBase: "企业知识库",
    });
  });
});
