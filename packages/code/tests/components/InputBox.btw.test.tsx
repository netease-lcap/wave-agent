import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render as originalRender } from "ink-testing-library";
import {
  InputBox,
  INPUT_PLACEHOLDER_TEXT_PREFIX,
} from "../../src/components/InputBox.js";
import { stripAnsiColors } from "wave-agent-sdk";

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

const mockSetPermissionMode = vi.fn();
const mockSetIsBtwActive = vi.fn();
const mockAskBtw: Mock<
  (
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
  ) => Promise<string>
> = vi.fn();

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    permissionMode: "default",
    setPermissionMode: mockSetPermissionMode,
    setIsBtwActive: mockSetIsBtwActive,
    backgroundTasks: [],
    messages: [],
    handleRewindSelect: vi.fn(),
    backgroundCurrentTask: vi.fn(),
    askBtw: mockAskBtw,
  }),
}));

describe("InputBox /btw", () => {
  beforeEach(() => {
    mockAskBtw.mockReset();
  });

  it("should show only the loading text until the answer completes", async () => {
    // Keep the onAskBtw promise pending so the test can observe the
    // intermediate loading state before releasing the final answer.
    let capturedOnContent: ((content: string) => void) | undefined;
    let resolveBtw: (answer: string) => void = () => {};
    mockAskBtw.mockImplementation(
      async (
        _question: string,
        _abortSignal?: AbortSignal,
        onContent?: (content: string) => void,
      ) => {
        capturedOnContent = onContent;
        return new Promise<string>((resolve) => {
          resolveBtw = resolve;
        });
      },
    );

    const { stdin, lastFrame } = render(<InputBox />);

    // Char-by-char typing: the space after "btw" closes the command selector
    // opened by "/", so Enter submits the /btw question.
    stdin.write("/btw what is life?");
    await vi.waitFor(() =>
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "/btw what is life?",
      ),
    );

    stdin.write("\r");
    await vi.waitFor(() =>
      expect(mockAskBtw).toHaveBeenCalledWith(
        "what is life?",
        expect.any(AbortSignal),
        expect.any(Function),
      ),
    );

    // While loading, only the question line and the loading text show.
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("/btw what is life?");
      expect(output).toContain("✻ Answering...");
    });

    // Streaming chunks arrive but are never displayed — only the loading text.
    capturedOnContent?.("42 is the");
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("✻ Answering...");
      expect(output).not.toContain("42 is the");
    });

    // Completion: Markdown render, loading text gone, dismiss hint appears.
    resolveBtw("42 is the meaning of life");
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("42 is the meaning of life");
      expect(output).not.toContain("Answering...");
      expect(output).toContain("Escape to dismiss");
    });
  });

  it("should hide the input row while the bare /btw usage shows and restore it on Escape", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Bare "/btw" + Enter shows the usage message.
    stdin.write("/btw\r");
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("Usage: /btw <your question>");
      expect(output).toContain("Escape to dismiss");
    });

    // The input row (placeholder) is hidden while the usage message renders.
    expect(stripAnsiColors(lastFrame() || "")).not.toContain(
      INPUT_PLACEHOLDER_TEXT_PREFIX,
    );

    // Escape dismisses the usage message and restores the input row.
    stdin.write("\u001b");
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).not.toContain("Usage: /btw");
      expect(output).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);
    });
  });
});
