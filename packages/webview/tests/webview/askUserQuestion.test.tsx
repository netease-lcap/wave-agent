import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";
import { ASK_USER_QUESTION_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message } from "wave-agent-sdk";

describe("AskUserQuestion Newline Support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should support newlines in question and answer", async () => {
    renderChatApp();

    const mockMessage: Message = {
      id: "msg_ask_1",
      role: "assistant" as const,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          type: "tool" as const,
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "end" as const,
          result: JSON.stringify({
            answers: {
              "Question with\nnewline": "Answer with\nnewline",
            },
          }),
        },
      ],
    };

    act(() => {
      sendCommand("updateMessages", { messages: [mockMessage] });
    });

    await waitFor(() => {
      expect(document.querySelector(".ask-user-result-q")).toBeInTheDocument();
    });

    const questionElement = document.querySelector(".ask-user-result-q")!;
    const answerElement = document.querySelector(".ask-user-result-a")!;

    // toHaveTextContent normalizes whitespace, so check textContent directly for newlines
    expect(questionElement.textContent).toBe("Question with\nnewline");
    expect(answerElement.textContent).toBe("Answer with\nnewline");

    // Verify white-space: pre-wrap is applied via inline style
    expect(questionElement.getAttribute("style")).toContain("pre-wrap");
    expect(answerElement.getAttribute("style")).toContain("pre-wrap");
  });

  it("should support automatic wrapping for long text", async () => {
    renderChatApp();

    const longText =
      "This is a very long text that should wrap automatically because of pre-wrap setting. ".repeat(
        10,
      );
    const mockMessage: Message = {
      id: "msg_ask_2",
      role: "assistant" as const,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          type: "tool" as const,
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "end" as const,
          result: JSON.stringify({
            answers: {
              "Long Question": longText,
            },
          }),
        },
      ],
    };

    act(() => {
      sendCommand("updateMessages", { messages: [mockMessage] });
    });

    await waitFor(() => {
      expect(document.querySelector(".ask-user-result-a")).toBeInTheDocument();
    });

    const answerElement = document.querySelector(".ask-user-result-a")!;
    expect(answerElement.textContent).toBe(longText);
    expect(answerElement.getAttribute("style")).toContain("pre-wrap");
  });

  // 加了 annotations（带预览的题目会回传选中项 preview 全文 + 备注）之后，
  // 结果载荷不再只有 `answers` 一个键。回显必须按键名取 `answers`，不能靠
  // 「整个对象只有一个键」——否则整份载荷会被当成答案表，题面变成 "answers"
  // / "annotations"、答案是一整坨 JSON。
  it("renders answers with annotations as Q&A pairs, not as JSON", async () => {
    renderChatApp();

    const notes = "先按 B 做，回头再补 A";
    const mockMessage: Message = {
      id: "msg_ask_3",
      role: "assistant" as const,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          type: "tool" as const,
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "end" as const,
          result: JSON.stringify({
            answers: { "面板宽度按哪档做？": "先做 A 档" },
            annotations: {
              "面板宽度按哪档做？": {
                preview: "面板 320px\n tab 单行",
                notes,
              },
            },
          }),
        },
      ],
    };

    act(() => {
      sendCommand("updateMessages", { messages: [mockMessage] });
    });

    await waitFor(() => {
      expect(document.querySelector(".ask-user-result-q")).toBeInTheDocument();
    });

    const questions = document.querySelectorAll(".ask-user-result-q");
    expect(questions).toHaveLength(1);
    expect(questions[0].textContent).toBe("面板宽度按哪档做？");
    expect(document.querySelector(".ask-user-result-a")!.textContent).toBe(
      "先做 A 档",
    );
    expect(
      document.querySelector(".ask-user-result-notes")!.textContent,
    ).toContain(notes);
    // 整份载荷（含 annotations）不能被原样倒出来。
    expect(document.querySelector(".result-raw")).toBeNull();
  });

  // 旧宿主 / CLI 只发裸的答案表（没有 `answers` 包一层），得继续按问答对渲染。
  it("still accepts a bare answers map from older hosts", async () => {
    renderChatApp();

    const mockMessage: Message = {
      id: "msg_ask_4",
      role: "assistant" as const,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          type: "tool" as const,
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "end" as const,
          result: JSON.stringify({ "Old question": "Old answer" }),
        },
      ],
    };

    act(() => {
      sendCommand("updateMessages", { messages: [mockMessage] });
    });

    await waitFor(() => {
      expect(document.querySelector(".ask-user-result-q")).toBeInTheDocument();
    });

    expect(document.querySelector(".ask-user-result-q")!.textContent).toBe(
      "Old question",
    );
    expect(document.querySelector(".ask-user-result-a")!.textContent).toBe(
      "Old answer",
    );
    expect(document.querySelector(".ask-user-result-notes")).toBeNull();
  });
});

// 「备注可单独成答」与「未答不阻塞提交」（ask-user-tool.md「选项预览与备注」
// 场景 9 / 10 +「多问题循环轮播」场景 7 / 8 / 10）：预览题里备注非空即算答过，
// 主按钮恒可点、只用「还有 N 题未答」提示未答数，未答且无备注的题在提交载荷里
// 整条省略（不是空串）。
describe("AskUserQuestion notes-only answer and partial submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const showAskUser = (questions: unknown[]) => {
    act(() => {
      sendCommand("showConfirmation", {
        confirmationId: "ask-user-notes",
        toolName: ASK_USER_QUESTION_TOOL_NAME,
        confirmationType: "需要确认",
        toolInput: { questions },
      });
    });
  };

  const waitForDialog = () =>
    waitFor(() => {
      expect(
        document.querySelector(".confirmation-dialog"),
      ).toBeInTheDocument();
    });

  const submitButton = () =>
    document.querySelector<HTMLButtonElement>(".confirmation-btn-apply")!;

  const submit = () => {
    const apply = submitButton();
    expect(apply).not.toBeDisabled();
    act(() => {
      fireEvent.click(apply);
    });
  };

  const sentPayload = (vscode: ReturnType<typeof renderChatApp>["vscode"]) => {
    const response = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m.command === "confirmationResponse");
    expect(response).toBeDefined();
    return JSON.parse(response.decision.message) as {
      answers: Record<string, string | string[]>;
      annotations?: Record<string, { preview?: string; notes?: string }>;
    };
  };

  it("counts a preview note as the answer when no option is selected", async () => {
    const { vscode } = renderChatApp();
    showAskUser([
      {
        question: "选哪个版式？",
        options: [
          { label: "方案 A", preview: "### 方案 A" },
          { label: "方案 B", preview: "### 方案 B" },
        ],
      },
    ]);
    await waitForDialog();

    act(() => {
      fireEvent.change(document.querySelector(".option-notes textarea")!, {
        target: { value: "两个都行，先按 A 做" },
      });
    });

    // 只写备注也算答过：不显示未答数，主按钮可点。
    expect(
      document.querySelector("[data-testid='question-navigation-hint']"),
    ).toBeNull();
    submit();

    const payload = sentPayload(vscode);
    expect(payload.answers["选哪个版式？"]).toBe("(notes only)");
    expect(payload.annotations?.["选哪个版式？"]).toEqual({
      notes: "两个都行，先按 A 做",
    });
  });

  it("submits with unanswered questions and says how many are left", async () => {
    const { vscode } = renderChatApp();
    showAskUser([
      { question: "选哪个版式？", options: [{ label: "方案 A" }] },
      { question: "选哪个范围？", options: [{ label: "大" }, { label: "小" }] },
    ]);
    await waitForDialog();

    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });

    expect(
      document.querySelector("[data-testid='question-navigation-hint']"),
    ).toHaveTextContent("还有 1 题未答");
    submit();

    const payload = sentPayload(vscode);
    expect(payload.answers["选哪个版式？"]).toBe("方案 A");
    // 未答的题整条省略 —— 既不是空串，也没有 `__other__` 这类占位。
    expect("选哪个范围？" in payload.answers).toBe(false);
  });

  it("hides the hint once every question is answered", async () => {
    renderChatApp();
    showAskUser([
      { question: "第一题", options: [{ label: "A" }] },
      { question: "第二题", options: [{ label: "B" }] },
    ]);
    await waitForDialog();

    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });
    expect(
      document.querySelector("[data-testid='question-navigation-hint']"),
    ).toHaveTextContent("还有 1 题未答");

    act(() => {
      fireEvent.click(document.querySelector('[aria-label="下一个"]')!);
    });
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });

    await waitFor(() => {
      expect(
        document.querySelector("[data-testid='question-navigation-hint']"),
      ).toBeNull();
    });
  });

  it("omits a question whose Other was selected but left empty", async () => {
    const { vscode } = renderChatApp();
    showAskUser([
      { question: "选哪个范围？", options: [{ label: "大" }, { label: "小" }] },
    ]);
    await waitForDialog();

    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    submit();

    const payload = sentPayload(vscode);
    expect(payload.answers).toEqual({});
    expect("选哪个范围？" in payload.answers).toBe(false);
  });
});
