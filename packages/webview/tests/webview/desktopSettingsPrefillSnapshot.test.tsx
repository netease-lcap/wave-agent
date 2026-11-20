/**
 * 设置页预填提示词 × 宿主快照到达时序（desktop）。
 *
 * 迁移自 `e2e/desktop-settings-prefill-snapshot.e2e.ts`。
 *
 * 线上缺陷回归：桌面端 设置 →「钩子」→「+ 新增钩子」后，会话输入框是空的；
 * 切走会话再切回来，预填提示词才出现。
 *
 * 根因（时序）：关掉设置页后 pane 行重挂载，宿主 `pushInitialState` 按
 * `authStatusResponse` → `setInitialState` 的顺序回放。前者就把 `initialized`
 * 置真、让输入区挂载，于是设置页的预填请求在这一步被写进输入框；紧跟其后的
 * `setInitialState` 又把 `inputContent`（宿主此刻只有空草稿）作为受控值灌回
 * MessageInput，`innerText` 被整段置空 —— 预填文本在首屏被抹掉，只剩宿主的草稿
 * 存储，所以切走再切回（重新回放快照）才看得见。
 *
 * 修复 = 预填写在「本条 pane 的权威快照落地」之后（而不是 authStatus 一到就写），
 * 并在输入框/快照都未就绪时保留请求、就绪后重放。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  twoFrames,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/**
 * 挂起 pane 首屏：工作目录到了、认证状态也到了，但**这条 pane 的权威快照还没
 * 落地**（原文刻意不发 `setInitialState`，复现的正是那个窗口）。
 */
async function mountPane() {
  const { vscode } = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("authStatusResponse", { isAuthenticated: true });
  await expect
    .poll(() => isVisible('[data-testid="message-input"]'))
    .toBe(true);
  return vscode;
}

/** 在会话输入框里敲 `/hooks` 回车 → 设置页「钩子」视图，再点「新增钩子」。 */
async function openHooksAndCreate() {
  const input = screen.getByTestId("message-input");
  await userEvent.click(input);
  await userEvent.keyboard("/hooks");
  await userEvent.keyboard("{Enter}");
  const create = await screen.findByRole("button", { name: /新增钩子/ });
  await userEvent.click(create);
}

describe("设置页预填提示词 × 宿主快照到达时序（desktop）", () => {
  it("快照落地后预填提示词必须在首屏（不被 setInitialState 冲掉）", async () => {
    await page.viewport(1280, 720);
    await mountPane();
    await openHooksAndCreate();

    // 关设置页 → pane 行重挂载 → 宿主真实回放顺序
    sendCommand("authStatusResponse", { isAuthenticated: true });
    // 两条宿主消息之间必然至少隔了一帧（React 的 passive effect 就在这一帧之后
    // 的调度任务里跑），原文为此显式等两帧，否则竞态窗口会被错过去。
    await twoFrames();
    // 这两帧同时证明「快照未落地时没先写」：authStatus 已经让输入区挂载，若预填
    // 此刻就落进输入框，紧接着的 setInitialState 会把它冲掉（下面那条断言会在
    // 没有闸门时先红在这里，红因更接近根因）。
    expect(
      document.querySelector('[data-testid="message-input"]')?.textContent ??
        "",
    ).not.toContain("用户级钩子");
    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("之前的问题")],
      tasks: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      inputContent: "",
      permissionMode: "default",
    });

    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="message-input"]')
            ?.textContent ?? "",
      )
      .toContain("用户级钩子");
  });

  it("认证状态到达但快照未落地时不得先写草案（写入会被快照重置）", async () => {
    await page.viewport(1280, 720);
    await mountPane();
    await openHooksAndCreate();

    sendCommand("authStatusResponse", { isAuthenticated: true });
    // 此刻输入框已挂载但 pane 快照未到 —— 这时写进去的草案会被紧随其后的
    // setInitialState 清空，所以应当保持 pending、等快照到了再写。
    expect(isVisible('[data-testid="message-input"]')).toBe(true);
    expect(
      document.querySelector('[data-testid="message-input"]')?.textContent ??
        "",
    ).not.toContain("用户级钩子");
  });
});
