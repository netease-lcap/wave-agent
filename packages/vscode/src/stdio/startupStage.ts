/**
 * 启动阶段文案的宿主侧缓存（spec: docs/specs/ui/stdio-transport.md「首次启动的
 * 进度文案」）。
 *
 * 慢在哪儿：CLI 刚起来时自装 ripgrep/sharp，扩展宿主则要把内置 CLI 拷到
 * `~/.wave/cli/vscode`——这两个阶段都发生在**聊天面板挂载完成之前**，那时
 * `postMessage` 没有接收者。所以宿主先记下最后一条文案，`webviewReady` 时补发
 * 一次；初始状态送达之后清空（那时界面上已经没有扫光动画，文案也没有落脚点）。
 *
 * 只存文案不存阶段 id：文案表在 SDK 的 `constants`（三个宿主共用一份），这里
 * 不做第二份映射。
 */

import { startupStageText, type StartupStage } from "wave-agent-sdk/host";

let current: string | null = null;

/** 记下一条阶段文案（后到覆盖先到），供随后挂载的 webview 补发。 */
export function recordStartupStage(stage: StartupStage): void {
  const text = startupStageText(stage);
  if (text) current = text;
}

/** 最后一条阶段文案；还没上报过任何阶段时是 null。 */
export function peekStartupStageText(): string | null {
  return current;
}

/** 整条阶段流结束了（初始状态已送达）。 */
export function clearStartupStageText(): void {
  current = null;
}
