/**
 * 桌面端未认证时的发送入口形态。
 *
 * 迁移自 `e2e/desktop-unauthenticated-input-disabled.e2e.ts`。出处：spec
 * `docs/specs/enterprise/sso-auth.md`「未认证时发送入口禁用」（2026-09-10 拍板：
 * 两端同一形态——未登录时复用 MessageInput 既有的 disabled 语义，禁用原因只写在
 * 输入框占位文案里）。
 *
 * 单测对照 `unauthenticatedInputDisabled.test.tsx`（插件端未登录）与
 * `desktopApp.test.tsx`「should disable the input area when no workdir is
 * selected」（桌面未选目录）；这里在同一份桌面端宿主档里把两条原因放在一起，
 * 验证它们**各自独立生效**且登录原因优先于目录原因。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { act, screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const WORKDIR = "/Users/dev/projects/wave-agent";
/** 输入框在两种原因都解除之后的默认占位（MessageInput 的既有文案）。 */
const DEFAULT_PLACEHOLDER = "/快捷指令，@添加上下文，粘贴图片，Enter发送...";

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/**
 * DesktopApp 只在 `desktopWorkdirState` 之后挂载布局，故按真实顺序推消息
 * （与 `bootDesktop` 同一条链路；差别只在这里要按 e2e 的载荷原样推「没有任何
 * 工作目录」的那种状态）。
 */
function boot(workdir: string | undefined, isAuthenticated: boolean) {
  const result = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    ...(workdir ? { workdir } : {}),
    recentWorkdirs: workdir ? [workdir] : [],
  });
  sendCommand("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated,
    permissionMode: "default",
    ...(workdir ? { workdir } : {}),
  });
  return result;
}

/** 推一条宿主消息并等 React 把这轮状态改完（真事件之外的状态变更走 act）。 */
async function push(command: string, data: Record<string, unknown>) {
  await act(async () => {
    sendCommand(command, data);
  });
}

const messageInput = () => screen.getByTestId("message-input");

describe("桌面端未认证时的发送入口", () => {
  it("未登录（未选目录）时禁用，占位文案是登录原因而非目录提示", async () => {
    await page.viewport(1280, 720);
    boot(undefined, false);

    const input = messageInput();
    expect(input).toHaveAttribute("contenteditable", "false");
    // 未登录是更根本的原因：即使同时没有工作目录，显示的是登录原因。
    expect(input).toHaveAttribute("data-placeholder", "请先登录后再发送消息");
    expect(screen.getByLabelText("添加")).toBeDisabled();
    expect(screen.getByLabelText("快捷指令")).toBeDisabled();
  });

  it("登录后仍未选目录：仍禁用，但占位文案换成目录原因（两条原因独立）", async () => {
    await page.viewport(1280, 720);
    boot(undefined, false);
    expect(messageInput()).toHaveAttribute(
      "data-placeholder",
      "请先登录后再发送消息",
    );

    await push("authStatusResponse", { isAuthenticated: true });

    const input = messageInput();
    expect(input).toHaveAttribute("contenteditable", "false");
    // 不再是登录原因 —— 剩下的唯一原因是没选工作目录，占位文案随之换成目录原因。
    expect(input).toHaveAttribute("data-placeholder", "请先选择项目目录");
  });

  it("登录且选定目录后恢复可编辑、占位回到默认提示", async () => {
    await page.viewport(1280, 720);
    boot(undefined, false);
    expect(messageInput()).toHaveAttribute("contenteditable", "false");

    await push("authStatusResponse", { isAuthenticated: true });
    await push("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await push("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
      workdir: WORKDIR,
    });

    const input = messageInput();
    expect(input).toHaveAttribute("contenteditable", "true");
    expect(input).toHaveAttribute("data-placeholder", DEFAULT_PLACEHOLDER);
    expect(screen.getByLabelText("添加")).toBeEnabled();
    expect(screen.getByLabelText("快捷指令")).toBeEnabled();
  });
});
