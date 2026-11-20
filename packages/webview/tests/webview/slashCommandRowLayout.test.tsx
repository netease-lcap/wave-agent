/**
 * 斜杠命令弹层：选项**恒为一行**，描述走右侧气泡（悬停 / 键盘选中），只有没有悬停
 * 能力的设备才在选项内显示描述（CSS `hover: none`）。
 *
 * 旧形态是「名称行 + 描述最多两行」，长描述把选项从 ~40 撑到 ~60，长短混排的列表高度
 * 参差 —— 弹窗本身早有 `max-height`，失控的是单项。这里用真浏览器几何钉住：
 * 1. 三个选项等高（描述长短不影响）；
 * 2. 有 `hover: hover` 时选项内描述不可见；
 * 3. 描述在右侧气泡里，且跟着悬停 / 键盘选中走。
 *
 * 迁移自 `e2e/slash-command-row-layout.e2e.ts`：几何与 `:hover` 在本套件的真
 * Chromium 里都是原生的（`userEvent` 走 CDP 真输入），不需要单独的 Playwright 工程。
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { page, userEvent } from "vitest/browser";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";
import "../../src/styles/globals.css";
import "../../src/styles/host-desktop.css";

const DIR_A = "/work/a";

// 刻意写长：这条描述曾经能把选项撑成两行。
const LONG_DESCRIPTION =
  "回滚到之前的用户消息，并把会话上下文一并恢复到那一条之后，适合在试错之后重新来过；这条描述故意写得很长，因为它要证明长描述不会再把这个选项撑高";

const REQUEST_DESCRIPTION = "回滚到之前的用户消息";
const LOOP_DESCRIPTION = "按固定间隔反复执行提示词";

interface RowBox {
  name: string;
  height: number;
  descriptionDisplay: string | null;
}

const sentCommands = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls.map(
    ([msg]) => (msg as { command?: string }).command,
  );

async function openPopup() {
  await page.viewport(700, 600);
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  // 一条一条发：`desktopWorkdirState` 挂出 ChatApp，下一条才落得到它的监听上。
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
  });

  const input = document.querySelector<HTMLElement>(
    '[data-testid="message-input"]',
  )!;
  input.focus();
  await userEvent.keyboard("/");
  await expect
    .poll(() => sentCommands(vscode).includes("requestSlashCommands"))
    .toBe(true);

  sendCommand("slashCommandsResponse", {
    commands: [
      {
        id: "rewind",
        name: "rewind",
        description: REQUEST_DESCRIPTION,
      },
      {
        id: "artifact",
        name: "artifact",
        description: LONG_DESCRIPTION,
        skillSource: "builtin",
      },
      {
        id: "loop",
        name: "loop",
        description: LOOP_DESCRIPTION,
        skillSource: "user",
      },
    ],
  });
  await expect
    .poll(() => document.querySelectorAll(".slash-command-item").length)
    .toBe(3);

  const rows: RowBox[] = Array.from(
    document.querySelectorAll(".slash-command-item"),
  ).map((item) => {
    const description = item.querySelector(".slash-command-description");
    return {
      name: item.querySelector(".slash-command-name")?.textContent ?? "",
      height: Math.round(item.getBoundingClientRect().height),
      descriptionDisplay: description
        ? getComputedStyle(description).display
        : null,
    };
  });
  return { rows };
}

/** 右侧气泡：可见的那一颗（`tooltip-right` + `visible`），最多一颗。 */
const visibleBubbles = () =>
  Array.from(
    document.querySelectorAll(".tooltip-box.tooltip-right.visible"),
  ).map((el) => el.textContent);

describe("斜杠弹层选项布局", () => {
  it("长描述不再把那一项撑高", async () => {
    const { rows } = await openPopup();
    expect(rows.map((row) => row.name)).toEqual([
      "/rewind",
      "/artifact",
      "/loop",
    ]);

    // 三个选项等高 —— 长的 /artifact 描述不再把这一项撑成两行。
    const heights = new Set(rows.map((row) => row.height));
    expect(
      [...heights],
      `row heights should be uniform, got ${JSON.stringify(rows)}`,
    ).toHaveLength(1);

    // 单行：名称行 + 上下内衬，不会超过名称行两倍的高度。
    expect(rows[0].height).toBeLessThanOrEqual(32);

    // 有悬停能力的环境（Chromium 默认 `hover: hover`）里，描述不出现在列表内。
    for (const row of rows) expect(row.descriptionDisplay).toBe("none");
  });

  it("描述跟着悬停与键盘选中走进右侧气泡", async () => {
    await openPopup();

    // 第一项默认选中：右侧气泡给出它的描述。
    expect(visibleBubbles()).toEqual([REQUEST_DESCRIPTION]);

    // 键盘 ↓ 到第二项：气泡换成那条长描述（焦点在输入框，没有 hover 可依赖）。
    await userEvent.keyboard("{ArrowDown}");
    expect(visibleBubbles()).toEqual([LONG_DESCRIPTION]);

    // 鼠标悬停第三项：只剩悬停项那颗气泡，选中项那颗让位。
    const loopRow = document.querySelector<HTMLElement>(
      '[data-testid="slash-command-loop"] .slash-command-row',
    )!;
    await userEvent.hover(loopRow);
    expect(visibleBubbles()).toEqual([LOOP_DESCRIPTION]);
  });
});
