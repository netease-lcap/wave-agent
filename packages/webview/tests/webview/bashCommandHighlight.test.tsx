import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { BASH_TOOL_NAME, POWERSHELL_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "../../src/types";

// Bash 工具命令行的语法高亮（specs/ui/message-rendering-system.md「Bash 工具
// 命令行的语法高亮」）：AI 调用的 Bash 工具与 bash 模式共用 `renderBashIO`，
// 含输出 / 只有命令两种形态都要着色；命令原文逐字节不变；命令里的 URL 与文件
// 路径仍是纯文本（本规格刻意不链接化）；净化只放行 span + class。
// DOMPurify 必须是真的：白名单没放行 <span> 时高亮会被静默剥掉，只有真净化能
// 测出这件事。

function renderBashCommand(
  command: string,
  options?: { result?: string; stage?: "running" | "end" },
) {
  const message = {
    id: "msg-bash-command-highlight-1",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        parameters: JSON.stringify({ command }),
        compactParams: command,
        stage: options?.stage ?? "end",
        success: true,
        result: options?.result,
      },
    ],
  } as unknown as MessageType;
  const { container } = render(
    <Message message={message} vscode={createMockVscode()} />,
  );
  const input = container.querySelector(".bash-command") as HTMLElement | null;
  return {
    container,
    input,
    tokens: () =>
      Array.from(input?.querySelectorAll("span") ?? []) as HTMLElement[],
  };
}

describe("bash command syntax highlighting", () => {
  it("colors the command of a bash tool block that has output", () => {
    const command = "cd /tmp && echo $HOME";
    const { input, tokens } = renderBashCommand(command, {
      result: "done\n",
    });

    expect(input).not.toBeNull();
    // 只加行内元素，命令原文逐字节不变
    expect(input?.textContent).toBe(command);
    expect(tokens().some((el) => el.classList.contains("hljs-built_in"))).toBe(
      true,
    );
    expect(tokens().some((el) => el.classList.contains("hljs-variable"))).toBe(
      true,
    );
  });

  it("colors the command when there is no output yet", () => {
    const command = "echo ready && tail -f build.log";
    const { container, input, tokens } = renderBashCommand(command, {
      stage: "running",
    });

    // 无输出形态：只有命令块，没有统一的输入/输出外框
    expect(container.querySelector(".bash-command-unified")).toBeNull();
    expect(input?.textContent).toBe(command);
    expect(tokens().length).toBeGreaterThan(0);
  });

  it("keeps URLs and file paths in a command as plain text", () => {
    const command = "curl http://127.0.0.1:3000/health /home/u/proj/a.ts";
    const { input } = renderBashCommand(command, { result: "ok\n" });

    expect(input?.textContent).toBe(command);
    // 命令行刻意不链接化（spec 场景 5）
    expect(input?.querySelector("a")).toBeNull();
  });

  it("escapes markup in a command so nothing but spans survives", () => {
    const command = 'echo "<img src=x onerror=alert(1)>"';
    const { input } = renderBashCommand(command, { result: "ok\n" });

    expect(input?.querySelector("img")).toBeNull();
    expect(input?.textContent).toBe(command);
  });
});

// PowerShell 与 Bash 共用一套块（`isShellToolName`），但**不**共用着色器：
// hljs 没有 powershell 语法，用 bash 硬染会把 `-Param`、`$env:PATH` 染成错的
// 颜色。所以 PS 走纯文本转义，形状与 Bash 一致、token 为零。
describe("PowerShell tool blocks render as shell blocks", () => {
  function renderPowerShellCommand(command: string, result?: string) {
    const message = {
      id: "msg-ps-command-1",
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: POWERSHELL_TOOL_NAME,
          parameters: JSON.stringify({ command }),
          compactParams: command,
          stage: "end",
          success: true,
          result,
        },
      ],
    } as unknown as MessageType;
    const { container } = render(
      <Message message={message} vscode={createMockVscode()} />,
    );
    return {
      container,
      input: container.querySelector(".bash-command") as HTMLElement | null,
    };
  }

  it("renders the command in the same shell block as Bash", () => {
    const command = "Get-ChildItem -Recurse -Filter *.ts";
    const { container, input } = renderPowerShellCommand(command, "a.ts\n");

    expect(container.querySelector(".bash-command-unified")).not.toBeNull();
    expect(input?.textContent).toBe(command);
    expect(container.querySelector(".bash-command-output")).toHaveTextContent(
      "a.ts",
    );
  });

  it("leaves a PowerShell command as plain text instead of bash-highlighting it", () => {
    const command = 'Write-Output "$env:PATH"';
    const { input } = renderPowerShellCommand(command);

    expect(input?.textContent).toBe(command);
    expect(input?.querySelectorAll("span").length).toBe(0);
  });

  it("still escapes markup in a PowerShell command", () => {
    const command = 'Write-Output "<img src=x onerror=alert(1)>"';
    const { input } = renderPowerShellCommand(command);

    expect(input?.querySelector("img")).toBeNull();
    expect(input?.textContent).toBe(command);
  });
});
