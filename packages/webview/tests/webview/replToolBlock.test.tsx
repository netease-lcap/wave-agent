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

  it("keeps a long script line on one line, scrolling sideways instead of wrapping", () => {
    // 场景 13：脚本是代码，长行不折行、横向看全；输出区不跟，终端输出折行才是对的。
    const longLine = `const veryLong = await Read({ file_path: "${"/tmp/".repeat(60)}a.ts" });`;
    const { container, code, output } = renderRepl({
      code: longLine,
      data: { ok: true, stdout: [longLine], result: "ok" },
    });
    const input = container.querySelector(".bash-command-input") as HTMLElement;

    expect(getComputedStyle(code as HTMLElement).whiteSpace).toBe("pre");
    expect(input.scrollWidth).toBeGreaterThan(input.clientWidth + 1);
    expect(getComputedStyle(output as HTMLElement).whiteSpace).toBe("pre-wrap");
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
