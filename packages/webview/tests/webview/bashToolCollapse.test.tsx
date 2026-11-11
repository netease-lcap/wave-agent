import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode, userEvent } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType, ToolBlock } from "../../src/types";

// Bash 工具块默认收起（specs/ui/message-rendering-system.md「Bash 工具块默认
// 收起」）：Bash 是唯一把完整输入与输出无条件下沉进消息流的工具，所以已结束且
// 成功的块只留一行，点开才渲染命令与输出。运行中 / 失败 / `!` 模式刻意不收起。
//
// 断言锚在语义上（`aria-expanded`、`.bash-tool-header` 是 button、正文节点在不在
// DOM 里），并量真实布局（单测跑在真 Chromium 里）——收起行的「一行」是几何事实，
// 不是文本里没有换行符：多行命令的摘要文本照样带 `\n`，靠 `white-space: nowrap`
// 压成一行。

const COMMAND = "pnpm test -- --coverage";
const DESCRIPTION = "运行测试套件并生成覆盖率报告";
const OUTPUT = "Test Files  3 passed (3)\n      Tests  16 passed (16)";

function bashBlock(overrides: Partial<ToolBlock> = {}): ToolBlock {
  return {
    type: "tool",
    name: BASH_TOOL_NAME,
    parameters: JSON.stringify({ command: COMMAND, description: DESCRIPTION }),
    compactParams: DESCRIPTION,
    stage: "end",
    success: true,
    result: OUTPUT,
    ...overrides,
  } as ToolBlock;
}

function renderBash(
  block: ToolBlock,
  options?: { role?: "assistant" | "user" },
) {
  const vscode = createMockVscode();
  const make = (b: ToolBlock) => (
    <Message
      message={
        {
          id: "msg-bash-collapse",
          role: options?.role ?? "assistant",
          blocks: [b],
        } as unknown as MessageType
      }
      vscode={vscode}
    />
  );
  const rendered = render(make(block));
  return {
    ...rendered,
    vscode,
    /** 把同一个块推到下一个阶段（同一组件实例，保持折叠状态）。 */
    updateBlock: (next: ToolBlock) => rendered.rerender(make(next)),
    row: () =>
      rendered.container.querySelector(".bash-tool-header") as HTMLElement,
  };
}

describe("bash 工具块默认收起", () => {
  it("已结束且成功的块只留一行，命令与输出不渲染进 DOM", () => {
    const { container, row } = renderBash(bashBlock());

    // 场景 1：折叠态根本不产出这两个节点（不是 display:none）
    expect(container.querySelector(".bash-command-unified")).toBeNull();
    expect(container.querySelector(".bash-command-output")).toBeNull();
    expect(container.querySelector(".bash-command")).toBeNull();

    const header = row();
    expect(header).not.toBeNull();
    expect(header.tagName).toBe("BUTTON");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header.textContent).toContain("Bash");
    expect(header.textContent).toContain(DESCRIPTION);
    // 收起行不带结果末几行（与 CLI 的刻意不同，spec 该故事的「与 CLI 的刻意不同」段）
    expect(header.textContent).not.toContain("Tests  16 passed");
    expect(container.querySelector(".bash-tool-label")).not.toBeNull();
  });

  it("点击工具行展开命令与输出，内容逐字节一致；再点回到收起态", async () => {
    const user = userEvent.setup();
    const { container, row } = renderBash(bashBlock());

    await user.click(row());
    expect(row()).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".bash-command")?.textContent).toBe(COMMAND);
    const output = container.querySelector(
      ".bash-command-output",
    ) as HTMLElement;
    // 输出进渲染前会被 trim（Message.renderBashIO 的既有行为）
    expect(output.textContent).toBe(OUTPUT.trim());
    // 场景 9：展开后仍是既有那份实现——max-height 120 + 滚动
    const style = getComputedStyle(output);
    expect(style.maxHeight).toBe("120px");
    expect(style.overflowY).toBe("auto");

    await user.click(row());
    expect(row()).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".bash-command-output")).toBeNull();
    expect(container.querySelector(".bash-command")).toBeNull();
  });

  it("展开后的正文里点击链接、选中文本不被工具行的点击劫持", async () => {
    const user = userEvent.setup();
    const { container, row } = renderBash(
      bashBlock({ result: "see http://localhost:8000/ for details" }),
    );

    await user.click(row());
    const output = container.querySelector(
      ".bash-command-output",
    ) as HTMLElement;
    expect(output.querySelector("a")).not.toBeNull();

    // 点正文不改变折叠状态（正文不在 button 里）。
    // 链接在插件端保持原生导航，这里只关心「没有把块收起来」。
    fireEvent.click(output);
    expect(row()).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".bash-command-output")).not.toBeNull();
  });

  it("工具行可用键盘操作：聚焦后 Enter / Space 切换", async () => {
    const user = userEvent.setup();
    const { container, row } = renderBash(bashBlock());

    row().focus();
    expect(row()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(container.querySelector(".bash-command-output")).not.toBeNull();
    expect(row()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(container.querySelector(".bash-command-output")).toBeNull();
    expect(row()).toHaveAttribute("aria-expanded", "false");
  });

  it("运行中的块保持展开，阶段首次进入 end 时自动收起一次", () => {
    const { container, row, updateBlock } = renderBash(
      bashBlock({ stage: "running", success: undefined }),
    );

    // 场景 3：实时输出是等待期唯一的反馈，不点也可见
    expect(container.querySelector(".bash-command-output")).not.toBeNull();
    expect(row()).toHaveAttribute("aria-expanded", "true");

    updateBlock(bashBlock());

    expect(container.querySelector(".bash-command-output")).toBeNull();
    expect(row()).toHaveAttribute("aria-expanded", "false");
  });

  it("运行中手动收起的块，跑完后不会自己展开", async () => {
    const user = userEvent.setup();
    const { container, row, updateBlock } = renderBash(
      bashBlock({ stage: "running", success: undefined }),
    );

    await user.click(row());
    expect(container.querySelector(".bash-command-output")).toBeNull();

    updateBlock(bashBlock());

    // 保持收起，也没有「又收一次」导致的任何翻转
    expect(row()).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".bash-command-output")).toBeNull();
  });

  it("失败的块不自动收起，错误块在任何折叠态都常显", async () => {
    const user = userEvent.setup();
    const { container, row } = renderBash(
      bashBlock({ success: false, error: "Command failed with exit code 1" }),
    );

    // 场景 4：红掉的命令与输出留在屏幕上
    expect(container.querySelector(".bash-command-output")).not.toBeNull();
    expect(row()).toHaveAttribute("aria-expanded", "true");
    const toolError = container.querySelector(".tool-error") as HTMLElement;
    expect(toolError).toHaveTextContent("Command failed with exit code 1");

    // 用户自己收起时，错误块不属于可折叠正文，仍然常显
    await user.click(row());
    expect(row()).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".bash-command-output")).toBeNull();
    expect(container.querySelector(".tool-error")).toHaveTextContent(
      "Command failed with exit code 1",
    );
  });

  it("运行中变成失败的块也不自动收起", () => {
    const { container, row, updateBlock } = renderBash(
      bashBlock({ stage: "running", success: undefined }),
    );

    updateBlock(bashBlock({ success: false, error: "Command failed" }));

    expect(container.querySelector(".bash-command-output")).not.toBeNull();
    expect(row()).toHaveAttribute("aria-expanded", "true");
  });

  it("`!` bash 模式（用户消息）常显，且没有折叠入口", () => {
    const message = MockDataGenerator.createBangMessage(
      "ls -la",
      "total 0\ndrwxr-xr-x  2 user  group  64 Mar 30 10:00 .",
      false,
      0,
    );
    const { container } = render(
      <Message message={message} vscode={createMockVscode()} />,
    );

    // 场景 5：自己敲的命令紧接着就要看结果，不给折叠
    expect(container.querySelector(".bash-tool-header")).toBeNull();
    const output = container.querySelector(
      ".bash-command-unified .bash-command-output",
    ) as HTMLElement;
    expect(output).not.toBeNull();
    expect(output.textContent).toContain("total 0");
  });

  it("展开态不持久化：重新挂载后回到收起态", async () => {
    const user = userEvent.setup();
    const first = renderBash(bashBlock());
    await user.click(first.row());
    expect(
      first.container.querySelector(".bash-command-output"),
    ).not.toBeNull();
    first.unmount();

    // 场景 6：切会话 / 回放历史 / 重连后重新拉取都是这个路径
    const second = renderBash(bashBlock());
    expect(second.row()).toHaveAttribute("aria-expanded", "false");
    expect(second.container.querySelector(".bash-command-output")).toBeNull();
  });

  it("没有可展开内容时工具行不做成可点控件", () => {
    // streaming 阶段 renderBashIO 返回 null：没有正文可展开，不制造空折叠。
    const { container } = renderBash(
      bashBlock({
        stage: "streaming",
        success: undefined,
        result: undefined,
        parameters: '{"comm',
      }),
    );

    expect(container.querySelector(".bash-tool-header")).toBeNull();
    expect(container.querySelector(".bash-command")).toBeNull();
    expect(container.querySelector(".tool-block")?.textContent).toContain(
      "Bash",
    );
  });

  it("多行命令的收起行压成一行，完整命令只在展开后可见", async () => {
    const user = userEvent.setup();
    const multiline = "cat <<'EOF' > /tmp/notes.md\n# 标题\n第二行\nEOF";
    const { container, row } = renderBash(
      bashBlock({
        parameters: JSON.stringify({ command: multiline }),
        compactParams: multiline,
      }),
    );

    // 摘要文本照样带换行符，靠 nowrap + ellipsis 压成一行
    const label = container.querySelector(".bash-tool-label") as HTMLElement;
    expect(label).not.toBeNull();
    const style = getComputedStyle(label);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
    // 几何事实：收起行就是一行的固定高度（.tool-block 的 18px）
    expect(row().getBoundingClientRect().height).toBeLessThan(24);

    await user.click(row());
    expect(container.querySelector(".bash-command")?.textContent).toBe(
      multiline,
    );
  });
});
