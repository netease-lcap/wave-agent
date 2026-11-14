import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render as originalRender } from "../helpers/inkHarness.js";
import { InputBox } from "../../src/components/InputBox.js";
import { stripAnsiColors } from "wave-agent-sdk";
import { pressKey } from "../helpers/pressKey.js";
import { AVAILABLE_COMMANDS } from "../../src/constants/commands.js";
import type { SlashCommand } from "wave-agent-sdk";

/**
 * 参数提示（spec commands/slash-commands.md「命令的作者能给出参数提示」）在 CLI
 * 那一侧的形态：命令插进输入框后，输入行末尾以**暗色文本**给出参数形状，用户一
 * 打参数就撤（CC CLI 的 `BaseTextInput` 用同一手法：一个 `dimColor` 的 `Text`
 * 挂在输入内容后面）。
 *
 * 判据与桌面端 / 插件端一致：输入内容 trim 后正好是 `/命令名`。
 */
let unmounts: Array<() => void> = [];
const render = (tree: React.ReactElement) => {
  const result = originalRender(tree);
  unmounts.push(result.unmount);
  return result;
};

afterEach(() => {
  unmounts.forEach((u) => u());
  unmounts = [];
});

vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    PromptHistoryManager: {
      addEntry: vi.fn().mockResolvedValue(undefined),
      searchHistory: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    permissionMode: "default",
    setPermissionMode: vi.fn(),
    setIsBtwActive: vi.fn(),
    backgroundTasks: [],
    messages: [],
    handleRewindSelect: vi.fn(),
    backgroundCurrentTask: vi.fn(),
  }),
}));

const WITH_HINT: SlashCommand = {
  id: "deploy",
  name: "deploy",
  description: "Deploy the current branch",
  argumentHint: "[环境] [分支]",
  handler: () => {},
};

const WITHOUT_HINT: SlashCommand = {
  id: "docs",
  name: "docs",
  description: "Generate documentation",
  handler: () => {},
};

/** 含提示的那一行原文。 */
const hintRow = (frame: string): string =>
  frame.split("\n").find((line) => stripAnsiColors(line).includes("[环境]")) ??
  "";

describe("InputBox 参数提示", () => {
  it("Tab 补全命令后，命令后面给出提示；打一个字就消失", async () => {
    const { stdin, lastFrame } = render(
      <InputBox slashCommands={[WITH_HINT, WITHOUT_HINT]} />,
    );

    stdin.write("/deploy");
    await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));

    // Tab = 只把命令插进输入框（Enter 是选中即执行，那条路没有参数可补）。
    await pressKey(stdin, "\t", () =>
      expect(stripAnsiColors(lastFrame() ?? "")).toContain("[环境] [分支]"),
    );

    // 提示接在命令后面、同一行上（它是行内片段，不是单独一行）。命令与提示之间的
    // 间隔有一格来自输入里那个尾随空格、一格来自末尾的光标块。
    expect(stripAnsiColors(hintRow(lastFrame() ?? ""))).toMatch(
      /^\/deploy\s+\[环境\] \[分支\]$/,
    );

    // 开始打参数 → 提示撤掉；删回只剩命令 → 提示回来。
    stdin.write("pre");
    await vi.waitFor(() =>
      expect(stripAnsiColors(lastFrame() ?? "")).not.toContain("[环境] [分支]"),
    );
    expect(lastFrame()).toContain("/deploy pre");

    for (let i = 0; i < 3; i++) stdin.write("\u007f");
    await vi.waitFor(() =>
      expect(stripAnsiColors(lastFrame() ?? "")).toContain("[环境] [分支]"),
    );
  });

  it("命令没有 argument-hint 时什么都不画", async () => {
    const { stdin, lastFrame } = render(
      <InputBox slashCommands={[WITH_HINT, WITHOUT_HINT]} />,
    );

    stdin.write("/docs");
    await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));
    await pressKey(stdin, "\t", () =>
      expect(stripAnsiColors(lastFrame() ?? "")).toContain("/docs"),
    );

    expect(stripAnsiColors(lastFrame() ?? "")).not.toContain("[环境] [分支]");
  });

  it("光标离开行尾时不画提示——它落在行尾，与光标位置对不上就会被当成命令内容", async () => {
    const { stdin, lastFrame } = render(
      <InputBox slashCommands={[WITH_HINT, WITHOUT_HINT]} />,
    );

    stdin.write("/deploy");
    await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));
    await pressKey(stdin, "\t", () =>
      expect(stripAnsiColors(lastFrame() ?? "")).toContain("[环境] [分支]"),
    );

    // ← 把光标挪回命令中间。
    await pressKey(stdin, "\u001b[D", () =>
      expect(stripAnsiColors(lastFrame() ?? "")).not.toContain("[环境] [分支]"),
    );
  });

  it("内置命令也有提示：手打 /add-dir 后给出参数形状", async () => {
    // 内置命令不走 `slashCommands`（那是 SDK 与插件下发的），提示来自 CLI 自己
    // 那张表；这里不传 `slashCommands`，提示仍然要出现。
    const { stdin, lastFrame } = render(<InputBox />);

    stdin.write("/add-dir ");
    await vi.waitFor(() =>
      expect(stripAnsiColors(lastFrame() ?? "")).toContain(
        "<path> [--remember]",
      ),
    );
  });

  it("只打开选择器的内置命令不给提示——提示只写给真正接参数的那几条", () => {
    // CC 的 `/model` 收 `[model]`（它支持手打模型名），我们的 `/model` 只打开
    // 模型选择器：给它一句提示等于教用户往一个不会被读取的位置写字。
    const hinted = AVAILABLE_COMMANDS.filter(
      (command) => command.argumentHint,
    ).map((command) => command.name);
    expect(hinted.sort()).toEqual([
      "add-dir",
      "btw",
      "compact",
      "plan",
      "rename",
    ]);
  });
});
