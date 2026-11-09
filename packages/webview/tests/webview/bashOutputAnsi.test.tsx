import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "../../src/types";

// 命令输出里的 ANSI 颜色由 UI 渲染成颜色而不是剥掉（见
// specs/ui/message-rendering-system.md「Bash 工具输出的终端颜色」与
// specs/core/bash-tools.md「ANSI 颜色代码」）。

const ESC = "\u001b";

function renderBashOutput(result: string) {
  const message = {
    id: "msg-bash-ansi-1",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        parameters: JSON.stringify({ command: "git diff" }),
        compactParams: "git diff",
        stage: "end",
        success: true,
        result,
      },
    ],
  } as unknown as MessageType;
  const rendered = render(
    <Message message={message} vscode={createMockVscode()} />,
  );
  const output = rendered.container.querySelector(
    ".bash-command-output",
  ) as HTMLElement;
  return { ...rendered, output };
}

describe("bash output ANSI colors", () => {
  it("renders colored output as colored spans with clean text", () => {
    const { output } = renderBashOutput(
      `${ESC}[32m+ added line${ESC}[0m\n${ESC}[31m- removed line${ESC}[0m\n`,
    );

    expect(output.querySelector(".ansi-fg-green")?.textContent).toBe(
      "+ added line",
    );
    expect(output.querySelector(".ansi-fg-red")?.textContent).toBe(
      "- removed line",
    );
    // 转义序列不显示成任何可见字符
    // 容器渲染前对 result 做了 trim（Message.tsx），末尾换行不在
    expect(output.textContent).toBe("+ added line\n- removed line");
    expect(output.innerHTML).not.toContain(ESC);
  });

  it("keeps uncolored output free of spans", () => {
    const { output } = renderBashOutput("all good\n");

    expect(output.textContent).toBe("all good");
    expect(output.querySelector("[class*='ansi-']")).toBeNull();
  });

  it("still links a URL that carries a color", () => {
    const { output } = renderBashOutput(
      `${ESC}[36mhttp://localhost:8000/${ESC}[0m`,
    );

    const link = output.querySelector("a") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("http://localhost:8000/");
    expect(link?.closest("[class*='ansi-fg-']")).not.toBeNull();
  });

  it("drops cursor-control sequences from the visible output", () => {
    const { output } = renderBashOutput(
      `${ESC}[2K${ESC}[1Gprogress: 100%${ESC}[K`,
    );

    expect(output.textContent).toBe("progress: 100%");
  });
});
