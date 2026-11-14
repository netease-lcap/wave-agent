import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";

/**
 * spec ui/slash-commands.md「命令的作者能给出参数提示」：命令插进输入框后，
 * 作者写的 `argument-hint` 以灰字跟在 `/命令 ` 后面，用户一打字就撤。
 *
 * 这里钉的是**可见性判据**（输入框上有没有 `data-argument-hint` 这个属性）：
 * 灰字本身由 CSS 的 `::after { content: attr(…) }` 画出来，不进 DOM，所以
 * 文案永远不会出现在 `textContent` / 草稿 / 发送内容里。
 */

async function openSlashPopup(command: {
  id: string;
  name: string;
  argumentHint?: string;
}) {
  const { vscode } = renderChatApp();
  const input = screen.getByTestId("message-input");
  input.focus();

  input.textContent = `/${command.name}`;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await fireInput(input, {
    data: `/${command.name}`,
    inputType: "insertText",
  });

  await waitFor(
    () => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "requestSlashCommands" }),
      );
    },
    { timeout: 3000 },
  );

  act(() => {
    sendCommand("slashCommandsResponse", {
      commands: [
        {
          id: command.id,
          name: command.name,
          description: "部署到某个环境",
          ...(command.argumentHint
            ? { argumentHint: command.argumentHint }
            : {}),
        },
      ],
    });
  });

  await waitFor(() => {
    expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
  });

  return { input };
}

/** 在输入框末尾模拟一次真实键入。 */
async function typeInto(input: HTMLElement, text: string) {
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  input.textContent = `${input.textContent ?? ""}${text}`;
  await fireInput(input, { data: text, inputType: "insertText" });
}

describe("快捷指令的参数提示", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("选中带 argument-hint 的命令后显示提示，用户一打字就撤", async () => {
    const { input } = await openSlashPopup({
      id: "deploy",
      name: "deploy",
      argumentHint: "[环境] [分支]",
    });

    // 判据照 CC 桌面端的 decoration：命令后面还得有一段空白才画——手打到全名、
    // 还没打空格的那一刻不显示（否则提示会与命令贴成一个 token）。
    expect(input.getAttribute("data-argument-hint")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // 插入的是 `/deploy `（带尾随空白）—— 提示挂出来，且不在正文里。
    expect(input.textContent).toBe("/deploy ");
    expect(input.getAttribute("data-argument-hint")).toBe("[环境] [分支]");

    // 补第一个参数 → 判据不再成立，提示撤掉（不需要任何显式清理）。
    await act(async () => {
      await typeInto(input, "prod");
    });
    expect(input.getAttribute("data-argument-hint")).toBeNull();
    expect(input.textContent).toBe("/deploy prod");

    // 把参数删光、只剩「命令 + 空白」→ 提示回来。
    await act(async () => {
      input.textContent = "/deploy ";
      await fireInput(input, { inputType: "deleteContentBackward" });
    });
    expect(input.getAttribute("data-argument-hint")).toBe("[环境] [分支]");
  });

  it("命令没有 argument-hint 时不挂这个属性", async () => {
    const { input } = await openSlashPopup({ id: "ship", name: "ship" });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(input.textContent).toBe("/ship ");
    expect(input.getAttribute("data-argument-hint")).toBeNull();
  });
});
