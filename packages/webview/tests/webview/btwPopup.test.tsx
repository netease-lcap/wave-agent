import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  fireInput,
  sendHostMessage,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import { sessionUi } from "../../src/utils/sessionUiStore";

/** A minimal SessionMetadata for conversation-switch tests. */
function session(id: string) {
  return {
    id,
    sessionType: "main" as const,
    workdir: "/tmp/test",
    createdAt: new Date(),
    lastActiveAt: new Date(),
    latestTotalTokens: 0,
  };
}

/** Set contenteditable text with selection inside a text node and fire input. */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  const existing = input.textContent || "";
  const fullText = existing + text;
  input.textContent = fullText;

  const range = document.createRange();
  if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
    const textNode = input.firstChild;
    range.setStart(textNode, textNode.textContent!.length);
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

/** Type text and click send, returning the mock vscode. */
async function sendText(text: string) {
  const { vscode } = renderChatApp();
  await typeInInput(text);
  act(() => {
    fireEvent.click(screen.getByTestId("send-btn"));
  });
  return vscode;
}

/** 每一次 askBtw 的 payload（按发出顺序）。 */
function askBtwPayloads(vscode: ReturnType<typeof renderChatApp>["vscode"]) {
  return vscode.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.command === "askBtw");
}

/** 在面板输入框里键入一句追问并回车发送。 */
function followUpInPanel(text: string) {
  const input = screen.getByTestId("btw-panel-input");
  fireEvent.change(input, { target: { value: text } });
  act(() => {
    fireEvent.keyDown(screen.getByTestId("btw-panel-input"), { key: "Enter" });
  });
}

describe("/btw Popup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 侧聊现在存在会话级快照里（sessionUi 是模块级单例），上一个用例留下的
    // 在途轮次会按 question 抢走本用例的回包归属，用例之间必须清干净。
    sessionUi.prune(new Set());
  });

  it("sends an askBtw RPC instead of a message and shows the loading panel", async () => {
    const vscode = await sendText("/btw what is the weather?");

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "askBtw",
        question: "what is the weather?",
      }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );

    expect(screen.getByTestId("btw-panel")).toBeInTheDocument();
    expect(screen.getByTestId("btw-panel-question").textContent).toBe(
      "what is the weather?",
    );
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();
    expect(screen.getByText("正在回答")).toBeInTheDocument();
    // 在途态只有一个信号：文案「正在回答」（闪烁的 ▋ 已按 1109 走查 BTW-15 移除）
    expect(screen.getByTestId("btw-panel-loading").textContent).toBe(
      "正在回答",
    );
  });

  it("shows only the streaming tail while loading and renders the finished answer as markdown", async () => {
    await sendText("/btw what is the weather?");
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("btw-panel-streaming")).not.toBeInTheDocument();

    // Thinking chunks accumulate into the tail while loading
    act(() => {
      sendCommand("btwStream", {
        question: "what is the weather?",
        content: "Let me think",
        type: "thinking",
      });
    });
    expect(screen.getByTestId("btw-panel-loading").textContent).toContain(
      "Let me think",
    );

    // Once the first content chunk arrives the accumulated thinking text is
    // discarded and only content feeds the tail (user decision: thinking is
    // not shown after the thinking phase ends).
    act(() => {
      sendCommand("btwStream", {
        question: "what is the weather?",
        content: " about it.",
        type: "thinking",
      });
    });
    act(() => {
      sendCommand("btwStream", {
        question: "what is the weather?",
        content: "Sunny",
        type: "content",
      });
    });
    act(() => {
      sendCommand("btwStream", {
        question: "what is the weather?",
        content: " and 25°C",
        type: "content",
      });
    });
    expect(screen.queryByTestId("btw-panel-streaming")).not.toBeInTheDocument();
    expect(screen.getByTestId("btw-panel").textContent).not.toContain(
      "Let me think",
    );
    // The loading tail shows the last 30 characters of the in-flight answer
    // (short text verbatim); the full streaming text is never shown.
    expect(screen.getByTestId("btw-loading-tail").textContent).toBe(
      "Sunny and 25°C",
    );
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();

    // The finished answer still lands via btwResponse and renders as markdown
    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "**Sunny** and 25°C",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("btw-panel-answer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("btw-panel-streaming")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btw-panel-loading")).not.toBeInTheDocument();
  });

  it("renders the answer as markdown when btwResponse arrives", async () => {
    await sendText("/btw what is the weather?");

    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "**Sunny** and 25°C",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("btw-panel-answer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("btw-panel-loading")).not.toBeInTheDocument();
    // dangerouslySetInnerHTML receives the rendered markdown (DOMPurify is mocked to pass through)
    expect(screen.getByTestId("btw-panel-answer").innerHTML).toContain(
      "<strong>Sunny</strong>",
    );
  });

  it("bare /btw shows the usage hint without sending anything", async () => {
    const vscode = await sendText("/btw");

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "askBtw" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );

    expect(screen.getByTestId("btw-panel")).toBeInTheDocument();
    // The `/btw ` prefix is always rendered (spec scenario 3) so the header
    // keeps a title and the close button stays on the right.
    expect(screen.getByText("/btw")).toBeInTheDocument();
    expect(screen.getByTestId("btw-panel-close")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("用法：/btw <你的问题>")).toBeInTheDocument();
    });
  });

  it("close button only hides the panel: the in-flight answer still lands and shows up on reopen", async () => {
    const vscode = await sendText("/btw what is the weather?");

    act(() => {
      fireEvent.click(screen.getByTestId("btw-panel-close"));
    });
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();

    // Closing hides, it does not cancel nor forget (spec「Webview 端继续提问」
    // 场景 7): the reply landing afterwards is kept for the conversation.
    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "Sunny",
      });
    });
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();

    // Reopening with a bare /btw brings the finished turn back, input ready.
    await typeInInput("/btw");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    const answers = screen.getAllByTestId("btw-panel-answer");
    expect(answers).toHaveLength(1);
    expect(answers[0].textContent).toContain("Sunny");
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("Escape closes the panel", async () => {
    await sendText("/btw what is the weather?");
    expect(screen.getByTestId("btw-panel")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();
  });

  it("Escape while streaming closes only the panel, never aborting the agent loop", async () => {
    const vscode = await sendText("/btw what is the weather?");
    // The main conversation is streaming — a plain Escape on the input would
    // normally fire onAbortMessage (MessageInput.tsx:1020). The btw panel's
    // capture-phase listener must swallow it first (spec scenario 9).
    act(() => {
      sendCommand("startStreaming");
    });

    const input = screen.getByTestId("message-input");
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "abortMessage" }),
    );
    // The main conversation keeps streaming
    expect(screen.getByTestId("message-input")).toBeInTheDocument();
  });

  it("shows an API error string when btwError arrives", async () => {
    await sendText("/btw what is the weather?");

    act(() => {
      sendCommand("btwError", {
        question: "what is the weather?",
        error: "rate limited",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("(API error: rate limited)")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("btw-panel-loading")).not.toBeInTheDocument();
  });

  it("ignores a stale reply whose question does not match the active one", async () => {
    await sendText("/btw first question");
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();

    act(() => {
      sendCommand("btwResponse", {
        question: "some other question",
        answer: "stale answer",
      });
    });

    // Still loading — the stale reply was dropped
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("btw-panel-answer")).not.toBeInTheDocument();
  });

  it("keeps the panel per conversation: switching away hides it, switching back restores it", async () => {
    renderChatApp();
    // Desktop pushes setInitialState with the activated session on a sidebar
    // conversation switch (pushPaneSessionState). Establish conversation A.
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    await typeInInput("/btw what is the weather?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "**Sunny**",
      });
    });
    expect(screen.getByTestId("btw-panel-answer")).toBeInTheDocument();

    // Switch to conversation B: the panel belongs to A (spec scenario 14), so B
    // starts clean — the panel is hidden, never carried over.
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-b") }),
    );
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();

    // Back to A: the answer is still there — switching only hides, it never
    // destroys (this is the whole point of storing the panel in the session
    // snapshot instead of a bare local useState).
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    expect(screen.getByTestId("btw-panel-answer").innerHTML).toContain(
      "<strong>Sunny</strong>",
    );
    expect(screen.getByTestId("btw-panel-question").textContent).toBe(
      "what is the weather?",
    );
  });

  it("an in-flight question keeps streaming while away and shows its tail on the way back", async () => {
    const { vscode } = renderChatApp();
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    await typeInInput("/btw what is the weather?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    act(() => {
      sendCommand("btwStream", {
        question: "what is the weather?",
        content: "Sunny",
        type: "content",
      });
    });

    // Leaving A does not cancel anything: the request keeps running (the host
    // never learned about the switch) and its reply lands on A's snapshot.
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-b") }),
    );
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();
    act(() => {
      sendCommand("btwStream", {
        question: "what is the weather?",
        content: " and 25°C",
        type: "content",
      });
    });
    // Still invisible in B — the arrival belongs to A.
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();

    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();
    expect(screen.getByTestId("btw-loading-tail").textContent).toBe(
      "Sunny and 25°C",
    );

    // …and the answer finishes into A as well.
    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "Sunny and 25°C",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("btw-panel-answer")).toBeInTheDocument();
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("drops a late reply in the conversation on screen when it belongs to another one", async () => {
    const { vscode } = renderChatApp();
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    await typeInInput("/btw what is the weather?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();

    // Switch while the askBtw RPC is still in flight: B must not show A's
    // panel nor the answer that lands afterwards (spec scenario 14).
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-b") }),
    );
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();

    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "Sunny",
      });
    });
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("forgets the panel of a conversation that was deleted", async () => {
    renderChatApp();
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    await typeInInput("/btw what is the weather?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    act(() => {
      sendCommand("btwResponse", {
        question: "what is the weather?",
        answer: "Sunny",
      });
    });
    expect(screen.getByTestId("btw-panel-answer")).toBeInTheDocument();

    // Switch away, then the host reports the session list without session-a
    // (deleted in the sidebar): its panel dies with the conversation and never
    // comes back, even if that id shows up again (spec 边界情况: 会话被删除后
    // 面板不会复活).
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-b") }),
    );
    act(() => {
      sendCommand("updateSessions", { sessions: [session("session-b")] });
    });
    sendHostMessage(
      fixtures.setInitialState({ session: session("session-a") }),
    );
    expect(screen.queryByTestId("btw-panel")).not.toBeInTheDocument();
  });

  it("asks a follow-up from the panel and replays the finished turns as history", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("/btw first?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    act(() => {
      sendCommand("btwResponse", { question: "first?", answer: "one" });
    });

    followUpInPanel("second?");

    // 两轮都在面板里，头部标题跟着最新一问走
    expect(screen.getAllByTestId("btw-turn")).toHaveLength(2);
    expect(screen.getByTestId("btw-panel-question").textContent).toBe(
      "second?",
    );
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();

    // 首轮不带历史；追问把此前**已完成**的轮次带上（对齐 CC 的 btw_history）
    const asks = askBtwPayloads(vscode);
    expect(asks).toHaveLength(2);
    expect(asks[0].history).toBeUndefined();
    expect(asks[1]).toMatchObject({
      question: "second?",
      history: [{ question: "first?", answer: "one" }],
    });
    // requestId 逐轮不同：重复问同一句时回包也分得清
    expect(typeof asks[0].requestId).toBe("string");
    expect(asks[1].requestId).not.toBe(asks[0].requestId);
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("sends at most the last 10 finished turns as history", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("/btw q1");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    for (let i = 1; i <= 11; i++) {
      act(() => {
        sendCommand("btwResponse", { question: `q${i}`, answer: `a${i}` });
      });
      if (i < 11) followUpInPanel(`q${i + 1}`);
    }
    followUpInPanel("q12");

    const asks = askBtwPayloads(vscode);
    expect(asks).toHaveLength(12);
    expect(asks[11].history).toHaveLength(10);
    expect(asks[11].history[0]).toEqual({ question: "q2", answer: "a2" });
    expect(asks[11].history[9]).toEqual({ question: "q11", answer: "a11" });
    // 面板里 11 轮已完成 + 第 12 轮在等答案
    expect(screen.getAllByTestId("btw-panel-answer")).toHaveLength(11);
  });

  it("keeps an in-flight turn out of the history it sends", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("/btw first?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // 主输入框的 /btw 在面板已开时追加一轮，而不是重置（spec 场景 8）
    await typeInInput("/btw second?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    const asks = askBtwPayloads(vscode);
    expect(asks).toHaveLength(2);
    // 第一轮还在途，不能当作历史发出去
    expect(asks[1].history).toBeUndefined();
    expect(screen.getAllByTestId("btw-panel-loading")).toHaveLength(2);
  });

  it("routes a reply to its own turn by requestId even when the question repeats", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("/btw same question");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    await typeInInput("/btw same question");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    const [first, second] = askBtwPayloads(vscode);
    expect(second.requestId).not.toBe(first.requestId);

    act(() => {
      sendCommand("btwResponse", {
        question: "same question",
        requestId: second.requestId,
        answer: "second answer",
      });
    });

    // 只有第二轮完成，第一轮仍在途
    expect(screen.getAllByTestId("btw-panel-loading")).toHaveLength(1);
    expect(screen.getByTestId("btw-panel-answer").textContent).toContain(
      "second answer",
    );
  });

  it("clear empties the side chat and drops the replies that were in flight", async () => {
    await sendText("/btw first?");
    expect(screen.getByTestId("btw-panel-loading")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("btw-panel-clear"));
    });

    // 面板留着、轮次清空、焦点回到输入框（spec 场景 6）
    expect(screen.getByTestId("btw-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("btw-turn")).not.toBeInTheDocument();
    expect(screen.getByTestId("btw-panel-empty")).toBeInTheDocument();
    expect(screen.getByTestId("btw-panel-input")).toHaveFocus();

    // 清空之后迟到的那一轮无处可落
    act(() => {
      sendCommand("btwResponse", { question: "first?", answer: "late" });
    });
    expect(screen.queryByTestId("btw-panel-answer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btw-turn")).not.toBeInTheDocument();
  });

  it("moves the caret into the follow-up input once the first answer lands", async () => {
    renderChatApp();
    const mainInput = screen.getByTestId("message-input");
    mainInput.focus();
    await typeInInput("/btw first?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // 面板是「带着一轮在途」挂载的：输入框开局就禁用，浏览器不给禁用控件焦点，
    // 这一刻光标还在主输入框（对齐 CC：它在发出问题之前就把光标放进侧聊输入框，
    // 之后输入框转成禁用并不会把已经拿到手的焦点夺走）。
    const input = screen.getByTestId("btw-panel-input");
    expect(input).toBeDisabled();
    expect(mainInput).toHaveFocus();

    act(() => {
      sendCommand("btwResponse", { question: "first?", answer: "one" });
    });

    // 答案落地、输入框恢复可用后补上那一次焦点，用户可以直接接着追问
    expect(input).toHaveFocus();
  });

  it("leaves the caret alone if the user has already moved on", async () => {
    renderChatApp();
    const mainInput = screen.getByTestId("message-input");
    mainInput.focus();
    await typeInInput("/btw first?");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // 还在等答案，用户已经点回主输入框接着写 —— 答案落地时不该把他拽走
    act(() => {
      mainInput.focus();
      fireEvent.keyDown(mainInput, { key: "n" });
    });
    act(() => {
      sendCommand("btwResponse", { question: "first?", answer: "one" });
    });

    expect(mainInput).toHaveFocus();
    expect(screen.getByTestId("btw-panel-input")).not.toHaveFocus();
  });

  it("switches the input placeholder, disables it while thinking, and keeps Shift+Enter from sending", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("/btw");
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // 空态先给用法提示 + 首问占位（发送方式写在占位文案里：面板没有发送键）
    expect(screen.getByTestId("btw-panel-input")).toHaveAttribute(
      "placeholder",
      "问个临时问题，Enter 发送",
    );

    followUpInPanel("first?");

    expect(screen.getByTestId("btw-panel-input")).toHaveAttribute(
      "placeholder",
      "继续提问，Enter 发送",
    );
    expect(screen.getByTestId("btw-panel-input")).toBeDisabled();
    expect(screen.queryByTestId("btw-panel-send")).not.toBeInTheDocument();

    act(() => {
      sendCommand("btwResponse", { question: "first?", answer: "one" });
    });

    const input = screen.getByTestId("btw-panel-input");
    fireEvent.change(input, { target: { value: "draft line" } });
    act(() => {
      fireEvent.keyDown(screen.getByTestId("btw-panel-input"), {
        key: "Enter",
        shiftKey: true,
      });
    });
    expect(askBtwPayloads(vscode)).toHaveLength(1);
  });

  it("selecting /btw in the slash popup inserts the prefix without sending", async () => {
    const { vscode } = renderChatApp();
    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/");
    await waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "btw", name: "btw", description: "Ask a side question" },
        { id: "config", name: "config", description: "Configuration" },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // btw and config both group under 系统指令 and keep the backend order
    // (btw 先于 config)，所以 Enter 选中的就是 btw。这里只断言前缀被插入。
    await waitFor(() => {
      expect(input.textContent).toBe("/btw ");
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "askBtw" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });
});
