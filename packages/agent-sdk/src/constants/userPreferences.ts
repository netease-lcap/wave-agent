/**
 * 用户偏好键的显示名（宿主侧反馈文案用）。
 *
 * 设置页的即时写盘一次只写一个键（spec core/agent-config.md「设置页控件的保存
 * 时机」），失败时宿主必须说清**是哪一项**没写进去——用户刚点的是哪一个，事后
 * 未必记得。文案模板：「设置未写入「<键名>」：<原因>」。
 *
 * 放在 SDK 常量里而不是各宿主各写一份：桌面端主进程与 VS Code 扩展后端都从
 * `wave-agent-sdk/host` 取值（该入口 re-export 本目录），三端文案不会漂；
 * JetBrains（Kotlin）那份是等价的本地副本，改动时两边一起改。
 *
 * 本模块必须保持零依赖（只允许 type import）：`wave-agent-sdk/constants` 是
 * webview 与宿主都能拉取的窄入口，见 scripts/check-sdk-surface.mjs 的闭包预算。
 */
import type { UserPreferenceKey } from "../types/configuration.js";

/** 键 → 设置页里那一行的标题（与 webview 的行标题逐字一致）。 */
export const USER_PREFERENCE_LABELS: Record<UserPreferenceKey, string> = {
  language: "AI 回复语言",
  contextLength: "上下文长度",
  autoMemoryEnabled: "开启自动记忆",
  autoMemoryFrequency: "触发记忆提取会话轮次",
  completionModel: "补全模型",
  completionEnabled: "代码补全",
  nextEditEnabled: "下一步编辑建议",
  enableKnowledgeBase: "企业知识库",
};

/**
 * 把一次写盘载荷的键翻译成给人看的名字，供失败提示使用。
 *
 * 载荷只应含一个键；万一宿主收到多个（老版本 webview 的整体保存），按顺序用
 * 「、」连起来，绝不回退出键名原文（`contextLength` 对用户没有意义）。
 */
export function describeUserPreferencePatch(
  patch: Record<string, unknown>,
): string {
  const labels = Object.keys(patch)
    .filter((key) => patch[key] !== undefined)
    .map(
      (key) =>
        USER_PREFERENCE_LABELS[key as UserPreferenceKey] ??
        // 未知键（新 webview + 旧宿主）：宁可显示键名，也不要显示空标签。
        key,
    );
  return labels.length > 0 ? labels.join("、") : "设置";
}
