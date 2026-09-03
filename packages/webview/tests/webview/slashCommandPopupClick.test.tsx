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
 * 回归测试：鼠标点击快捷指令弹窗中的 /rewind、/model 项，二级弹层必须打开
 * 且不被打开它的那一次 mousedown 立即关闭。
 *
 * 历史 bug：弹层在 mount 时同步向 document 注册 click-outside mousedown
 * 监听，而点击列表项的那次 mousedown 仍在冒泡 → 命中监听（target 是已卸载
 * 的列表项，在弹层外）→ 弹层被自己的打开点击瞬间关闭。键盘选中+回车无
 * mousedown 故正常。修复见 useClickOutside（延迟一帧注册）。
 */
async function clickSlashItem(trigger: string, itemTestId: string) {
  const { vscode } = renderChatApp();
  const input = screen.getByTestId("message-input");
  input.focus();

  input.textContent = trigger;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  await fireInput(input, { data: trigger, inputType: "insertText" });

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
        { id: "rewind", name: "rewind", description: "回滚到检查点" },
        { id: "model", name: "model", description: "选择模型" },
      ],
    });
  });

  await waitFor(() => {
    expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
  });

  // 模拟真实鼠标点击：列表项用 onMouseDown 选中（SlashCommandsPopup）。
  await act(async () => {
    fireEvent.mouseDown(screen.getByTestId(itemTestId));
  });
  return vscode;
}

describe("鼠标点击快捷指令打开二级弹层（回归）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/rewind：点击列表项后弹层打开，且不被同一次 mousedown 关闭", async () => {
    const vscode = await clickSlashItem("/rewind", "slash-command-rewind");

    await waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "listRewindCheckpoints" }),
        );
      },
      { timeout: 3000 },
    );
    // 弹层仍可见（未被自身的打开点击关闭）。
    expect(screen.getByTestId("rewind-popup")).toBeInTheDocument();
  });

  it("/model：点击列表项后弹层打开，且不被同一次 mousedown 关闭", async () => {
    const vscode = await clickSlashItem("/model", "slash-command-model");

    await waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "getConfiguredModels" }),
        );
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId("model-popup")).toBeInTheDocument();
  });
});
