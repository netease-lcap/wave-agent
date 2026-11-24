import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
// 这个文件**刻意**把真实样式表装进来：要守的不变量是「同一张卡在运行中与结束后
// 同形」，而两态的差别正是 CSS 层叠 + DOM 形状共同造成的（桌面端的卡片配色挂在
// .bash-command-unified 上）。只断言类名会放过「有外壳但配色没跟上」那一档。
import "../../src/styles/globals.css";
import "../../src/styles/host-desktop.css";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { REPL_TOOL_NAME, BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "../../src/types";

// Bash / REPL 卡片在「运行中（还没有输出）」与「结束后（有输出）」两态同形：
// 外壳、底色、内边距都挂在同一层，输出到达只是卡片往下长出下半截。
// 缺陷形态：无输出态漏了外壳，桌面端的卡片配色与内边距（挂在 unified 上）落回
// 基础档，于是同一张卡在输出到达那一刻换一次底色（暗色 #1b1d1e → #25292b）。

function makeMessage(
  name: string,
  options: { stage: "running" | "end"; output?: string },
) {
  const block: Record<string, unknown> = {
    type: "tool",
    name,
    parameters:
      name === BASH_TOOL_NAME
        ? JSON.stringify({ command: "pnpm -F wave-webview build" })
        : JSON.stringify({ code: "const a = 1; self.log('x');" }),
    compactParams: "x",
    stage: options.stage,
    success: true,
  };
  if (name === REPL_TOOL_NAME) {
    if (options.output !== undefined) {
      block.data = { ok: true, stdout: [options.output] };
    }
  } else if (options.output !== undefined) {
    block.result = options.output;
  }
  return {
    id: "m-card-parity",
    role: "assistant",
    blocks: [block],
  } as unknown as MessageType;
}

function measure(message: MessageType) {
  const { container, unmount } = render(
    <Message message={message} vscode={createMockVscode()} />,
  );
  const card = container.querySelector(".bash-command-unified");
  const input = container.querySelector(".bash-command-input") as HTMLElement;
  const style = getComputedStyle(input);
  const result = {
    hasCard: card !== null,
    hasOutput: container.querySelector(".bash-command-output") !== null,
    background: style.backgroundColor,
    padding: style.padding,
    bottomBorder: style.borderBottomWidth,
    cardBorder: card ? getComputedStyle(card).borderTopWidth : "0px",
  };
  unmount();
  return result;
}

describe.each([REPL_TOOL_NAME, BASH_TOOL_NAME])(
  "%s 卡片的两态同形",
  (toolName) => {
    it("运行中与结束后共用同一个外壳、同一份底色与内边距", () => {
      document.documentElement.dataset.host = "desktop";
      // 宿主会注入 --vscode-panel-border；测试环境没有时整条 border 声明失效，
      // 下面「卡片外框 1px」那条会退化成 0px 白绿。
      document.documentElement.style.setProperty(
        "--vscode-panel-border",
        "#34393c",
      );
      try {
        for (const theme of ["dark", "light"]) {
          document.documentElement.dataset.theme = theme;
          const running = measure(makeMessage(toolName, { stage: "running" }));
          const ended = measure(
            makeMessage(toolName, { stage: "end", output: "done" }),
          );

          // 运行中必须已经有外壳：卡片配色/内边距挂在它上面。
          expect(running.hasCard).toBe(true);
          expect(running.hasOutput).toBe(false);
          expect(ended.hasOutput).toBe(true);

          // 底色与内边距逐值相同 —— 输出到达时不换底色、不挪文字。
          expect(running.background).toBe(ended.background);
          expect(running.padding).toBe(ended.padding);

          // 只有上半截时，两段之间的分隔线必须让开（否则贴着容器底边成双线）。
          expect(running.bottomBorder).toBe("0px");
          // 卡片外框 1px —— 同时证明 --vscode-panel-border 已注入，上面那条不是白绿。
          expect(running.cardBorder).toBe("1px");
        }
      } finally {
        document.documentElement.style.removeProperty("--vscode-panel-border");
        delete document.documentElement.dataset.theme;
        delete document.documentElement.dataset.host;
      }
    });
  },
);
