import { describe, it, expect, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { BASH_TOOL_NAME, POWERSHELL_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "../../src/types";
// 桌面层那条断言的意义就在「host-desktop.css 的覆写没有把调色板改掉」，
// 所以这份样式必须真的进来（它所有选择器都带 `[data-host="desktop"]`）。
import "../../src/styles/host-desktop.css";

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

/**
 * 调色板真的落到屏幕上了（原 `e2e/bash-command-highlight.e2e.ts`）。
 *
 * 上面那些用例只证明「DOM 里生成了 token 元素」——token 有了但调色板没加载、
 * 或被 `.bash-command` 的基色压过，屏幕上仍是单色命令，它们一路绿。这里量的是
 * 浏览器算出来的颜色（本套件就跑在真 Chromium 里）。
 */
const BUILT_IN_RGB = "rgb(78, 201, 176)"; // #4ec9b0
const VARIABLE_RGB = "rgb(156, 220, 254)"; // #9cdcfe
const PROBE_COMMAND = "cd /tmp && echo $HOME";

function renderCommandColors() {
  const { container } = renderBashCommand(PROBE_COMMAND, { result: "done\n" });
  const colorOf = (selector: string) => {
    const el = container.querySelector(selector) as HTMLElement | null;
    return el ? getComputedStyle(el).color : null;
  };
  const command = container.querySelector(".bash-command") as HTMLElement;
  return {
    commandText: command?.textContent ?? null,
    commandBase: colorOf(".bash-command"),
    builtIn: colorOf(".bash-command .hljs-built_in"),
    variable: colorOf(".bash-command .hljs-variable"),
    anchors: command?.querySelectorAll("a").length ?? 0,
  };
}

describe("bash command highlight — computed colors", () => {
  afterEach(() => {
    delete document.documentElement.dataset.host;
    document.documentElement.removeAttribute("data-theme");
  });

  it("插件端：命令行按 shell 语法着色，且不链接化", () => {
    // 没有宿主标记就是插件端（editor 档）；桌面档的覆盖由下一条钉住
    expect(document.documentElement.dataset.host).toBeUndefined();

    const colors = renderCommandColors();

    // 命令原文逐字节不变
    expect(colors.commandText).toBe(PROBE_COMMAND);
    expect(colors.builtIn, "built_in 没有着色（调色板没加载？）").toBe(
      BUILT_IN_RGB,
    );
    expect(colors.variable, "变量没有着色").toBe(VARIABLE_RGB);
    // 反面证据：token 的颜色必须与命令基色不同，否则「有 span 但看着仍是单色」
    expect(colors.builtIn).not.toBe(colors.commandBase);
    // 命令行刻意不链接化（spec 场景 5）
    expect(colors.anchors).toBe(0);
  });

  it("桌面端：同一份调色板照常生效", () => {
    document.documentElement.dataset.host = "desktop";
    document.documentElement.setAttribute("data-theme", "dark");

    const colors = renderCommandColors();

    // 配色不按宿主分叉，这里只钉住「桌面层没有把它覆盖掉」。
    expect(document.documentElement.dataset.host).toBe("desktop");
    expect(colors.builtIn).toBe(BUILT_IN_RGB);
    expect(colors.variable).toBe(VARIABLE_RGB);
  });
});
