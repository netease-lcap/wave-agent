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
 * 回归测试：从快捷指令弹窗选中「本地指令」（config/mcp/status/rewind/model…
 * 打开对话框或设置页、不依赖光标位置的指令）时，不得把 '/' 前的输入框草稿
 * 整条清空。
 *
 * 历史 bug：handleSlashCommandSelect 的本地指令分支无条件
 * textareaRef.current.innerHTML = "" + setMessage("") +
 * updateInputContent("") —— 用户在 '/' 前打的草稿被静默丢弃。修复后与技能
 * 指令分支一致：只删除 [startPos, endPos) 的指令 token，剩余草稿留在输入框
 * 并上报宿主会话记忆（updateInputContent 传剩余文本而非空串）。
 */

// jsdom 未实现 innerText。给 message-input 挂一个实时 getter/setter 模拟
// 浏览器行为（textContent 是 jsdom 里可写的真实文本），使 MessageInput 内
// 读 innerText / 写 innerText 的地方与 DOM 保持一致。
function mockInnerText(el: HTMLElement) {
  Object.defineProperty(el, "innerText", {
    configurable: true,
    get: () => el.textContent ?? "",
    set: (value: string) => {
      el.textContent = value;
    },
  });
}

/** 把输入框内容设为 text（光标移到末尾），触发快捷指令检测并等弹窗出现。 */
async function openSlashPopup(text: string) {
  const { vscode } = renderChatApp();
  const input = screen.getByTestId("message-input");
  input.focus();
  mockInnerText(input);

  input.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  await fireInput(input, { data: text, inputType: "insertText" });

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
      commands: [{ id: "model", name: "model", description: "选择模型" }],
    });
  });

  await waitFor(() => {
    expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
  });

  // 清掉输入/弹窗检测期间产生的 postMessage 噪音，便于对选中后的行为精确断言。
  vscode.postMessage.mockClear();
  return { vscode, input };
}

describe("本地快捷指令选中不丢 '/' 前草稿（回归）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("草稿 + 空格 + /model：Enter 选中后草稿保留、指令照常发出、剩余文本上报宿主", async () => {
    const draft = "帮我分析这个报错";
    const { vscode, input } = await openSlashPopup(`${draft} /model`);

    // 弹窗打开时按 Enter → 选中本地指令 /model
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // 1) 本地指令照常执行（打开模型选择弹层，而非把含草稿的文本发给 agent）
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getConfiguredModels" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
    expect(screen.getByTestId("model-popup")).toBeInTheDocument();

    // 2) 输入框只剩 '/' 前的草稿（/model token 被删除）
    expect(input.textContent).toBe(`${draft} `);

    // 3) updateInputContent 上报剩余草稿而非空串 → 宿主会话记忆/切会话恢复不丢
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        content: `${draft} `,
      }),
    );
  });

  it("空框只输 /model：Enter 选中后输入框清空，行为与修复前一致", async () => {
    const { vscode, input } = await openSlashPopup("/model");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getConfiguredModels" }),
    );
    expect(input.textContent).toBe("");
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        content: "",
      }),
    );
  });
});
