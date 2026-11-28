import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { REPL_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "../../src/types";

// REPL 工具块的脚本与输出（specs/ui/message-rendering-system.md「REPL 工具块的
// 脚本与输出」）：脚本与输出挂成与 Bash 相同的卡片，两段都从 `ToolBlock.data`
// 直接取 —— 渲染器**不**解析给模型读的 `<repl-output>` 标记。

function renderRepl(options: {
  code: string;
  stage?: "streaming" | "running" | "end";
  data?: Record<string, unknown>;
  result?: string;
}) {
  const message = {
    id: "msg-repl-block-1",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: REPL_TOOL_NAME,
        // streaming 阶段参数是半截 JSON —— 与真实事件流一致。
        parameters:
          options.stage === "streaming"
            ? '{"code":"const n = awa'
            : JSON.stringify({ code: options.code, description: "数行" }),
        compactParams: "数行",
        stage: options.stage ?? "end",
        success: true,
        ...(options.data ? { data: options.data } : {}),
        ...(options.result !== undefined ? { result: options.result } : {}),
      },
    ],
  } as unknown as MessageType;
  const { container } = render(
    <Message message={message} vscode={createMockVscode()} />,
  );
  return {
    container,
    code: container.querySelector(".bash-command") as HTMLElement | null,
    output: container.querySelector(
      ".bash-command-output",
    ) as HTMLElement | null,
    card: container.querySelector(".repl-block") as HTMLElement | null,
  };
}

describe("REPL tool block", () => {
  it("renders the script with javascript highlighting, byte for byte", () => {
    const code = "const n = await Read({ file_path: 'a.ts' });\nreturn n;";
    const { code: element } = renderRepl({
      code,
      data: { ok: true, stdout: [] },
    });

    expect(element).not.toBeNull();
    expect(element?.textContent).toBe(code);
    const tokens = Array.from(element?.querySelectorAll("span") ?? []);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("shows self.log output and the returned value in one output area", () => {
    const { output } = renderRepl({
      code: "self.log('building');\nreturn 42;",
      data: { ok: true, evalId: 3, stdout: ["building"], result: "42" },
    });

    expect(output).not.toBeNull();
    expect(output?.textContent).toContain("building");
    const result = output?.querySelector(".repl-result");
    expect(result?.textContent).toContain("=>");
    expect(result?.textContent).toContain("42");
  });

  it("renders only the script while the script is still running", () => {
    const { code, output } = renderRepl({
      code: "await Bash({ command: 'sleep 5' });",
      stage: "running",
    });

    expect(code).not.toBeNull();
    expect(output).toBeNull();
  });

  it("keeps the script area the same height while running and after it ends", () => {
    // 场景 14：脚本区与 Bash 命令行共用同一条基础规则，没有输出那一档（running）
    // 少了外层卡片也必须一模一样——上限与可用宽度都相同，否则长脚本会在输出到达
    // 的那一刻重新折行、再跳高一次。
    const longScript = Array.from(
      { length: 30 },
      (_, i) => `const row${i} = await Read({ file_path: "row${i}.ts" });`,
    ).join("\n");
    const measure = (root: HTMLElement) => {
      const input = root.querySelector(".bash-command-input") as HTMLElement;
      const output = root.querySelector(".bash-command-output") as HTMLElement;
      const style = getComputedStyle(input);
      return {
        maxHeight: style.maxHeight,
        // 卡片下半截（输出区）与上半截共用同一个上限值，否则一张卡里两种滚动高度。
        outputMaxHeight: output ? getComputedStyle(output).maxHeight : null,
        // 可用内容宽度：`clientWidth` 不含边框，而边框两档归属不同（运行中在
        // 脚本区自己身上、结束后在外层容器上），所以剥掉左右 padding 再比。
        content:
          input.clientWidth -
          parseInt(style.paddingLeft) -
          parseInt(style.paddingRight),
        client: input.clientHeight,
        scroll: input.scrollHeight,
      };
    };

    // 宿主会注入 `--vscode-panel-border`，测试环境没有：缺了它整条 `border` 声明
    // 失效（1px 边框算成 0），比出来的宽度就不反映真机。
    document.documentElement.style.setProperty("--vscode-panel-border", "#333");
    try {
      const whileRunning = measure(
        renderRepl({ code: longScript, stage: "running" }).container,
      );
      const afterEnd = measure(
        renderRepl({ code: longScript, data: { ok: true, stdout: ["done"] } })
          .container,
      );

      // 与 Bash 命令行同一档：`--tool-code-max-height` 一处定义的 120px，两档都命中。
      expect(whileRunning.maxHeight).toBe("120px");
      expect(afterEnd.maxHeight).toBe("120px");
      // 输入区与输出区共用这一个值：一张卡里不该有两种上限。
      expect(afterEnd.outputMaxHeight).toBe(afterEnd.maxHeight);
      expect(whileRunning.content).toBe(afterEnd.content);
      expect(whileRunning.client).toBe(afterEnd.client);
      // 30 行确实撑破了上限——否则上面几条比的是同一段没被裁的内容，断言没有意义。
      expect(whileRunning.scroll).toBeGreaterThan(whileRunning.client);
    } finally {
      document.documentElement.style.removeProperty("--vscode-panel-border");
    }
  });

  it("reports a dispatch receipt instead of a result", () => {
    const { output } = renderRepl({
      code: "await sleep(1);",
      data: { ok: true, evalId: 7, stdout: [], asyncDispatched: true },
    });

    expect(output?.textContent).toContain("已派发 #7");
  });

  it("falls back to the generic text rendering without data", () => {
    // #3062 之前的转录：`result` 里是 `<repl-output>` 原文，接管就等于把标签
    // 打到屏幕上，所以没有 `data` 时完全落回通用渲染。
    const { card, container } = renderRepl({
      code: "return 1;",
      result: "<repl-output><result>1</result></repl-output>",
    });

    expect(card).toBeNull();
    expect(container.querySelector(".result-raw")).not.toBeNull();
  });

  it("does not render while parameters are still streaming", () => {
    const { code, card } = renderRepl({
      code: "return 1;",
      stage: "streaming",
      data: { ok: true, stdout: [] },
    });

    // 半截 JSON 里读不出脚本，落回通用工具行，不画半块卡片。
    expect(card).toBeNull();
    expect(code).toBeNull();
  });

  it("wraps a long script line on the card instead of scrolling sideways", () => {
    // 场景 13：模型写的脚本常常整段就一行，超宽行必须折行——横滚会让用户一路
    // 横向拖才能读完。这与 Bash 命令行同一套（`pre-wrap`），输出区也是 `pre-wrap`。
    const longLine = `const veryLong = await Read({ file_path: "${"/tmp/".repeat(60)}a.ts" });`;
    const { container, code, output } = renderRepl({
      code: longLine,
      data: { ok: true, stdout: [longLine], result: "ok" },
    });
    const input = container.querySelector(".bash-command-input") as HTMLElement;

    expect(getComputedStyle(code as HTMLElement).whiteSpace).toBe("pre-wrap");
    expect(input.scrollWidth).toBeLessThanOrEqual(input.clientWidth + 1);
    expect(getComputedStyle(output as HTMLElement).whiteSpace).toBe("pre-wrap");
  });

  it("工具行标题显示用户可见名 Code Mode（工具名仍是 REPL）", () => {
    const { container } = renderRepl({ code: "return 1;" });
    const header = container.querySelector(".tool-block-text");

    expect(header?.textContent).toContain("Code Mode");
    expect(header?.textContent).not.toContain(REPL_TOOL_NAME);
  });

  it("linkifies urls in the output but never in the script", () => {
    const { code, output } = renderRepl({
      code: "const r = await fetch('http://localhost:3000/x');",
      data: { ok: true, stdout: [], result: "http://localhost:3000/x" },
    });

    expect(code?.querySelector("a")).toBeNull();
    expect(output?.querySelector("a")).not.toBeNull();
  });
});
