import { describe, it, expect, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireInput,
  sendCommand,
} from "./test-utils";

/**
 * 回归测试：切换会话之后再输入 `/`，斜杠弹窗必须照常出现。
 *
 * 出处（2026-11-09 报障）：桌面端从当前对话切到「新对话」后，在输入框里打 `/`
 * **没有任何反应**——不弹窗、不报错；切回别的对话再切回来又恢复正常。
 *
 * 根因在 `MessageInput` 的光标位置去重：`handleSelectionChange` 用
 * `lastSelectionChangePosRef` 跳过「光标没动」的重复检测，而这个值只在用户输入
 * 派发的 `input` 事件里更新。会话切换走的是另一条路——effect 里直接
 * `renderDraftContent` 改写输入框 DOM、补发草稿，既不派发 `input` 事件也不重置
 * 该 ref。于是上一个会话留下的偏移量（例如光标停在 1）会和新会话里刚打下的 `/`
 * 撞成同一个数字，判等直接 return，斜杠弹窗与 `@` 提及的检测整段被吞掉。
 *
 * 为什么这一层能守：缺陷不在请求/回包，而在「请求根本没发出去」，宿主侧
 * （`desktopHost.handleSlashCommandsRequest`）收到的命令永远是空转的；而这条路径
 * （DOM 改写 + 去重）在单测里就能完整复现，不需要真机。
 */
/** 在输入框末尾打下 text，并把光标留在文本节点末尾（与真实输入一致）。 */
async function typeAtEnd(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();

  input.textContent = (input.textContent ?? "") + text;
  const range = document.createRange();
  if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
    range.setStart(input.firstChild, input.firstChild.textContent!.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(input);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  await fireInput(input, { data: text, inputType: "insertText" });
}

const sessionA = {
  id: "session-a",
  sessionType: "main",
  workdir: "/tmp/test",
  lastActiveAt: new Date(),
  createdAt: new Date(),
  latestTotalTokens: 0,
};
const sessionB = { ...sessionA, id: "session-b" };

function initialState(session: typeof sessionA, inputContent = "") {
  return {
    command: "setInitialState",
    messages: [],
    tasks: [],
    backgroundTasks: [],
    workflowRuns: [],
    isStreaming: false,
    isCommandRunning: false,
    isCompacting: false,
    isTaskListCollapsed: false,
    isRestoring: false,
    sessions: [sessionA, sessionB],
    session,
    pendingConfirmations: [],
    queuedMessages: [],
    isAuthenticated: true,
    workdir: "/tmp/test",
    inputContent,
  };
}

const slashResponse = {
  command: "slashCommandsResponse",
  commands: [
    {
      id: "rewind",
      name: "rewind",
      description: "回退到之前的用户消息",
      runOnSelect: true,
    },
  ],
};

describe("Slash command popup after a session switch", () => {
  it("requests commands again when '/' is typed in the new session", async () => {
    const { vscode } = renderChatApp();
    sendCommand("setInitialState", initialState(sessionA));

    // 会话 A：打 `/` → 请求发出、回包后弹窗出现（这一半原本就是好的）。
    await typeAtEnd("/");
    await waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );
    sendCommand("slashCommandsResponse", slashResponse);
    await waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeTruthy();
    });
    vi.mocked(vscode.postMessage).mockClear();

    // 切到会话 B：宿主推快照，输入框 DOM 被整体改写（草稿为空）。
    sendCommand("setInitialState", initialState(sessionB));
    await waitFor(() => {
      expect(screen.getByTestId("message-input").textContent).toBe("");
    });

    // 同一个位置（1）重新打 `/`：修好之前这里被「光标没动」直接跳过，
    // 请求一次都不发，界面上没有任何反应。
    await typeAtEnd("/");
    await waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    // 回包后弹窗展示的是**这一轮**的命令：用一条会话 A 那份列表里没有的文案
    // 收尾，避免「弹窗压根没关」把断言假绿。
    sendCommand("slashCommandsResponse", {
      command: "slashCommandsResponse",
      commands: [
        {
          id: "compact",
          name: "compact",
          description: "手动压缩对话历史",
          runOnSelect: true,
        },
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeTruthy();
    });
    expect(screen.getByTestId("slash-commands-popup").textContent).toContain(
      "手动压缩对话历史",
    );
  });
});
