import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
  waitFor,
} from "./test-utils";
import {
  EDIT_TOOL_NAME,
  BASH_TOOL_NAME,
  WRITE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";

describe("Confirmation Dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show compact confirmation dialog for ExitPlanMode without inline plan preview", async () => {
    renderChatApp();

    const planContent = "## Test Plan\n- Step 1\n- Step 2";

    // Simulate a confirmation request for ExitPlanMode tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_plan_confirmation",
        toolName: EXIT_PLAN_MODE_TOOL_NAME,
        confirmationType: "计划待确认",
        planContent: planContent,
      });
    });

    // Verify confirmation dialog is visible
    const confirmationDialog = document.querySelector(".confirmation-dialog");
    expect(confirmationDialog).toBeInTheDocument();

    // The plan is carried by each host (JB editor tab / VSCE preview panel / desktop Plan
    // panel), never rendered inline inside the shared confirmation dialog (确认框变小).
    expect(
      document.querySelector(".plan-content-preview"),
    ).not.toBeInTheDocument();

    // Verify buttons
    const applyBtn = document.querySelector(".confirmation-btn-apply");
    expect(applyBtn).toHaveTextContent("批准并继续");
    const autoBtn = document.querySelector(".confirmation-btn-auto");
    expect(autoBtn).toHaveTextContent("批准并自动接受后续修改");
  });

  it("should show confirmation dialog for code modification tools", async () => {
    renderChatApp();

    // Simulate a confirmation request for Edit tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation_123",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "test.ts",
          old_string: "old",
          new_string: "new",
        },
      });
    });

    // Verify confirmation dialog is visible
    const confirmationDialog = document.querySelector(".confirmation-dialog");
    expect(confirmationDialog).toBeInTheDocument();

    // Verify dialog content
    const title = document.querySelector(".confirmation-title");
    expect(title).toHaveTextContent("代码修改待确认");

    // Verify buttons are present
    const applyBtn = document.querySelector(".confirmation-btn-apply");
    expect(applyBtn).toHaveTextContent("批准并继续");
    const feedbackBtn = document.querySelector(".confirmation-btn-feedback");
    expect(feedbackBtn).toHaveTextContent("提供反馈");
    // reject button is only shown for EnterPlanMode and feedback cancel — not for Edit tool initially
    const rejectBtns = document.querySelectorAll(".confirmation-btn-reject");
    expect(rejectBtns.length).toBe(0);

    // Verify input is hidden when confirmation is showing (display:none, not removed from DOM)
    expect(screen.queryByTestId("message-input")).not.toBeVisible();
  });

  it("should show confirmation dialog for command execution tools", async () => {
    renderChatApp();

    // Simulate a confirmation request for Bash tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation_456",
        toolName: BASH_TOOL_NAME,
        confirmationType: "命令执行待确认",
        toolInput: { command: "rm -rf temp/" },
      });
    });

    // Verify confirmation dialog content for bash command
    const title = document.querySelector(".confirmation-title");
    expect(title).toHaveTextContent("命令执行待确认");
  });

  it("should send approval response when clicking apply button", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    // Simulate confirmation request
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation_789",
        toolName: WRITE_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "new_file.ts",
          content: 'console.log("hello");',
        },
      });
    });

    // Click apply button
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });

    // Verify confirmation dialog is hidden
    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();

    // Verify input is visible again
    expect(screen.getByTestId("message-input")).toBeVisible();

    // Verify approval message was sent to extension
    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_confirmation_789",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionMode: undefined,
      },
    });
  });

  it("should send rejection response when pressing Escape", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    // Simulate confirmation request
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation_reject",
        toolName: "SomeOtherTool",
        confirmationType: "操作待确认",
        toolInput: {},
      });
    });

    // Press Escape to reject
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // Verify confirmation dialog is hidden
    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();

    // Verify input is visible again
    expect(screen.getByTestId("message-input")).toBeVisible();

    // Verify rejection message was sent to extension
    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_confirmation_reject",
      approved: false,
    });
  });

  it("should send rejection response when clicking the close button", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation_close_btn",
        toolName: "SomeOtherTool",
        confirmationType: "操作待确认",
        toolInput: {},
      });
    });

    await act(async () => {
      fireEvent.click(document.querySelector(".confirmation-close-btn")!);
    });

    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_confirmation_close_btn",
      approved: false,
    });
  });

  it("should handle multiple confirmation requests sequentially", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    // First confirmation request
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "confirmation_1",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: { file_path: "file1.ts" },
      });
    });

    // Verify first confirmation is visible
    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(document.querySelector(".confirmation-title")).toHaveTextContent(
      "代码修改待确认",
    );

    // Approve first confirmation
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });

    // Verify dialog is hidden
    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();

    // Second confirmation request
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "confirmation_2",
        toolName: "SomeOtherTool",
        confirmationType: "操作待确认",
        toolInput: {},
      });
    });

    // Verify second confirmation is visible with correct content
    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(document.querySelector(".confirmation-title")).toHaveTextContent(
      "操作待确认",
    );

    // Reject second confirmation via Esc key
    await act(async () => {
      fireEvent.keyDown(
        document.querySelector(".confirmation-dialog") || document.body,
        { key: "Escape" },
      );
    });

    // Verify both responses were sent
    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "confirmation_1",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionMode: undefined,
      },
    });
    expect(sentMessages[1]).toEqual({
      command: "confirmationResponse",
      confirmationId: "confirmation_2",
      approved: false,
    });
  });

  it("should handle multiple simultaneous confirmation requests in a queue", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    // Send first confirmation request
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "conf_1",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: { file_path: "file1.ts" },
      });
    });

    // Verify first confirmation is visible
    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(document.querySelector(".confirmation-title")).toHaveTextContent(
      "代码修改待确认",
    );

    // Send second confirmation request while first is still showing
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "conf_2",
        toolName: BASH_TOOL_NAME,
        confirmationType: "命令执行待确认",
        toolInput: { command: "ls" },
      });
    });

    // Still should show first confirmation
    expect(document.querySelector(".confirmation-title")).toHaveTextContent(
      "代码修改待确认",
    );

    // Approve first confirmation
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });

    // Verify second confirmation is now visible
    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(document.querySelector(".confirmation-title")).toHaveTextContent(
      "命令执行待确认",
    );

    // Approve second confirmation
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });

    // Verify dialog is hidden and input is visible
    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("message-input")).toBeVisible();

    // Verify both responses were sent
    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "conf_1",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionMode: undefined,
      },
    });
    expect(sentMessages[1]).toEqual({
      command: "confirmationResponse",
      confirmationId: "conf_2",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionMode: undefined,
      },
    });
  });

  it("should handle confirmation for different tool types correctly", async () => {
    renderChatApp();

    const toolTests = [
      { toolName: EDIT_TOOL_NAME, expectedType: "代码修改待确认" },
      { toolName: WRITE_TOOL_NAME, expectedType: "代码修改待确认" },
      { toolName: BASH_TOOL_NAME, expectedType: "命令执行待确认" },
      { toolName: "SomeOtherTool", expectedType: "操作待确认" },
    ];

    for (const { toolName, expectedType } of toolTests) {
      // Show confirmation
      await act(async () => {
        sendCommand("showConfirmation", {
          confirmationId: `test_${toolName}`,
          toolName: toolName,
          confirmationType: expectedType,
          toolInput: {},
        });
      });

      // Verify correct confirmation type
      expect(document.querySelector(".confirmation-title")).toHaveTextContent(
        expectedType,
      );

      // Dismiss the dialog
      await act(async () => {
        fireEvent.click(
          document.querySelector(".confirmation-btn-apply") as HTMLElement,
        );
      });
      expect(
        document.querySelector(".confirmation-dialog"),
      ).not.toBeInTheDocument();
    }
  });

  it("should prevent user interaction with input while confirmation is shown", async () => {
    renderChatApp();

    // Verify input is initially visible
    expect(screen.getByTestId("message-input")).toBeVisible();

    // Show confirmation
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_input_hidden",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {},
      });
    });

    // Verify input is hidden (display:none wrapper, not removed from DOM)
    expect(screen.queryByTestId("message-input")).not.toBeVisible();

    // Verify confirmation dialog is visible
    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();

    // Approve confirmation
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });

    // Verify input becomes visible again
    expect(screen.getByTestId("message-input")).toBeVisible();
    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();
  });

  it("should show auto-confirm button for MCP tools with correct text", async () => {
    const { vscode } = renderChatApp();

    // Simulate confirmation request for MCP tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_mcp_confirmation",
        toolName: "mcp__fetch__web_fetch",
        confirmationType: "操作待确认",
        toolInput: { url: "https://example.com" },
      });
    });

    const confirmationDialog = document.querySelector(".confirmation-dialog");
    expect(confirmationDialog).toBeInTheDocument();

    // Verify apply button shows "批准并继续"
    expect(document.querySelector(".confirmation-btn-apply")).toHaveTextContent(
      "批准并继续",
    );

    // Verify auto button is visible with correct text
    const autoBtn = document.querySelector(".confirmation-btn-auto");
    expect(autoBtn).toBeInTheDocument();
    expect(autoBtn).toHaveTextContent("是，且不再询问：mcp__fetch__web_fetch");

    // Verify feedback button is visible
    expect(
      document.querySelector(".confirmation-btn-feedback"),
    ).toHaveTextContent("提供反馈");

    // Click auto-confirm and verify decision
    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(autoBtn as HTMLElement);
    });

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_mcp_confirmation",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionRule: "mcp__fetch__web_fetch",
      },
    });
  });

  it("should send allow decision for MCP tools when clicking apply", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    // Simulate confirmation request for MCP tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_mcp_apply",
        toolName: "mcp__tavily__search",
        confirmationType: "操作待确认",
        toolInput: { query: "test query" },
      });
    });

    // Click apply button
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_mcp_apply",
      approved: true,
      decision: {
        behavior: "allow",
      },
    });
  });

  it("should show file path for write and edit tool confirmations", async () => {
    renderChatApp();

    // Test Write tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_write_file_path",
        toolName: WRITE_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "src/utils/helper.ts",
          content: "export const x = 1;",
        },
      });
    });

    const confirmationDialog = document.querySelector(".confirmation-dialog");
    expect(confirmationDialog).toBeInTheDocument();
    expect(document.querySelector(".confirmation-file-path")).toHaveTextContent(
      "src/utils/helper.ts",
    );

    // Approve to dismiss
    await act(async () => {
      fireEvent.click(
        document.querySelector(".confirmation-btn-apply") as HTMLElement,
      );
    });
    expect(confirmationDialog).not.toBeInTheDocument();

    // Test Edit tool
    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_edit_file_path",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "src/components/App.tsx",
          old_string: "old",
          new_string: "new",
        },
      });
    });

    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(document.querySelector(".confirmation-file-path")).toHaveTextContent(
      "src/components/App.tsx",
    );
  });

  it("should show bypass button for Bash tool and send bypassPermissions decision", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_bash_bypass",
        toolName: BASH_TOOL_NAME,
        confirmationType: "命令执行待确认",
        toolInput: { command: "ls -la" },
      });
    });

    const bypassBtn = screen.getByText("是，并跳过权限确认").closest("button");
    expect(bypassBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(bypassBtn as HTMLElement);
    });

    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_bash_bypass",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionMode: "bypassPermissions",
      },
    });
  });

  it("should show bypass button for ExitPlanMode and send bypassPermissions decision", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_exit_plan_bypass",
        toolName: EXIT_PLAN_MODE_TOOL_NAME,
        confirmationType: "计划待确认",
        planContent: "## Test Plan\n- Step 1",
      });
    });

    const bypassBtn = screen.getByText("是，并跳过权限确认").closest("button");
    expect(bypassBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(bypassBtn as HTMLElement);
    });

    expect(
      document.querySelector(".confirmation-dialog"),
    ).not.toBeInTheDocument();

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toEqual({
      command: "confirmationResponse",
      confirmationId: "test_exit_plan_bypass",
      approved: true,
      decision: {
        behavior: "allow",
        newPermissionMode: "bypassPermissions",
      },
    });
  });

  it("should show bypass button even when persistent option is hidden", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_bash_bypass_dangerous",
        toolName: BASH_TOOL_NAME,
        confirmationType: "命令执行待确认",
        toolInput: { command: "rm -rf temp/" },
        hidePersistentOption: true,
      });
    });

    // Auto ("don't ask again") button hidden, bypass button still visible
    expect(
      screen.queryByText("是，且在此工作目录下不再询问此命令"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("是，并跳过权限确认")).toBeInTheDocument();
  });

  it("should not show bypass button for non-Bash tools", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_edit_no_bypass",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "test.ts",
          old_string: "old",
          new_string: "new",
        },
      });
    });

    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(screen.queryByText("是，并跳过权限确认")).not.toBeInTheDocument();
  });

  it("should not show bypass button for Bash tool in plan mode", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_bash_plan_no_bypass",
        toolName: BASH_TOOL_NAME,
        confirmationType: "命令执行待确认",
        toolInput: { command: "ls -la" },
        permissionMode: "plan",
      });
    });

    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(screen.queryByText("是，并跳过权限确认")).not.toBeInTheDocument();
  });

  it("should still show bypass button for ExitPlanMode in plan mode", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_exit_plan_mode_bypass",
        toolName: EXIT_PLAN_MODE_TOOL_NAME,
        confirmationType: "计划待确认",
        planContent: "## Test Plan\n- Step 1",
        permissionMode: "plan",
      });
    });

    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(screen.getByText("是，并跳过权限确认")).toBeInTheDocument();
  });
});

describe("AskUserQuestion Other input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const showAskUser = (questions: unknown[]) => {
    act(() => {
      sendCommand("showConfirmation", {
        confirmationId: "ask-user-other",
        toolName: ASK_USER_QUESTION_TOOL_NAME,
        confirmationType: "需要确认",
        toolInput: { questions },
      });
    });
  };

  const singleQuestion = [
    {
      question: "单选：选哪个方案？",
      options: [{ label: "方案 A" }, { label: "方案 B" }],
      multiSelect: false,
    },
  ];

  const waitForDialog = () =>
    waitFor(() => {
      expect(
        document.querySelector(".confirmation-dialog"),
      ).toBeInTheDocument();
    });

  it("should not show the other textarea until Other is selected", async () => {
    renderChatApp();
    showAskUser(singleQuestion);
    await waitForDialog();

    expect(document.querySelector(".other-text-input")).not.toBeInTheDocument();

    // Selecting a normal option keeps the textarea hidden
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });
    expect(document.querySelector(".other-text-input")).not.toBeInTheDocument();

    // Selecting Other reveals the textarea
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
  });

  it("shows a grey 输入自定义回答... hint before Other is selected, replaced by the textarea after", async () => {
    renderChatApp();
    showAskUser(singleQuestion);
    await waitForDialog();

    // Not selected: grey hint visible (option-description style), no textarea
    const hint = document.querySelector(".other-option .option-description");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent("输入自定义回答...");
    expect(document.querySelector(".other-text-input")).not.toBeInTheDocument();

    // Select Other: hint is replaced by the textarea
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(
      document.querySelector(".other-option .option-description"),
    ).not.toBeInTheDocument();
  });

  it("multi-select: shows the hint before checking Other and replaces it after", async () => {
    renderChatApp();
    showAskUser([
      {
        question: "多选：选择语言？",
        options: [{ label: "TypeScript" }, { label: "Python" }],
        multiSelect: true,
      },
    ]);
    await waitForDialog();

    expect(
      document.querySelector(".other-option .option-description"),
    ).toHaveTextContent("输入自定义回答...");

    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(
      document.querySelector(".other-option .option-description"),
    ).not.toBeInTheDocument();
  });

  it("should submit the typed custom answer for single-select", async () => {
    const { vscode } = renderChatApp();
    showAskUser(singleQuestion);
    await waitForDialog();

    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    act(() => {
      fireEvent.change(document.querySelector(".other-text-input")!, {
        target: { value: "自定义答案" },
      });
    });

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(document.querySelector(".confirmation-btn-apply")!);
    });

    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    const response = sent.find((m) => m.command === "confirmationResponse");
    expect(response).toBeDefined();
    const message = JSON.parse(response.decision.message);
    expect(message["单选：选哪个方案？"]).toBe("自定义答案");
  });

  it("should keep typed content when switching away from Other and back", async () => {
    renderChatApp();
    showAskUser(singleQuestion);
    await waitForDialog();

    // Select Other and type
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    act(() => {
      fireEvent.change(document.querySelector(".other-text-input")!, {
        target: { value: "自定义答案" },
      });
    });

    // Switch back to 方案 A -> textarea hides
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });
    await waitFor(() => {
      expect(
        document.querySelector(".other-text-input"),
      ).not.toBeInTheDocument();
    });

    // Select Other again -> content is restored
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(
      (document.querySelector(".other-text-input") as HTMLTextAreaElement)
        .value,
    ).toBe("自定义答案");
  });

  it("should not let focusing elements change the selected answer", async () => {
    renderChatApp();
    showAskUser(singleQuestion);
    await waitForDialog();

    // Select 方案 A
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });
    expect(
      document.querySelector('.option-item[data-option-index="0"]')?.className,
    ).toContain("selected");

    // The textarea must not exist (Other not selected), so it can never
    // swallow the answer when focus passes over it.
    expect(document.querySelector(".other-text-input")).not.toBeInTheDocument();

    // Focusing the Other label itself does not change the answer
    act(() => {
      fireEvent.focus(document.querySelector(".other-option")!);
    });
    expect(
      document.querySelector('.option-item[data-option-index="0"]')?.className,
    ).toContain("selected");
    expect(document.querySelector(".other-option")?.className).not.toContain(
      "selected",
    );
  });

  it("multi-select: shows textarea on checking Other and keeps content", async () => {
    renderChatApp();
    showAskUser([
      {
        question: "多选：哪些模块？",
        options: [{ label: "客户档案" }, { label: "合同管理" }],
        multiSelect: true,
      },
    ]);
    await waitForDialog();

    expect(document.querySelector(".other-text-input")).not.toBeInTheDocument();

    // Check Other -> textarea appears
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    act(() => {
      fireEvent.change(document.querySelector(".other-text-input")!, {
        target: { value: "数据看板" },
      });
    });

    // Uncheck Other -> textarea hides, content kept
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(
        document.querySelector(".other-text-input"),
      ).not.toBeInTheDocument();
    });

    // Re-check Other -> content restored
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(
      (document.querySelector(".other-text-input") as HTMLTextAreaElement)
        .value,
    ).toBe("数据看板");
  });

  it("multi-select: does not submit the other text when Other is unchecked", async () => {
    const { vscode } = renderChatApp();
    showAskUser([
      {
        question: "多选：哪些模块？",
        options: [{ label: "客户档案" }, { label: "合同管理" }],
        multiSelect: true,
      },
    ]);
    await waitForDialog();

    // Select 客户档案
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="checkbox"]',
        )!,
      );
    });
    // Check Other and type
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    act(() => {
      fireEvent.change(document.querySelector(".other-text-input")!, {
        target: { value: "数据看板" },
      });
    });
    // Uncheck Other again -> typed content must not be submitted
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(
        document.querySelector(".other-text-input"),
      ).not.toBeInTheDocument();
    });

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(document.querySelector(".confirmation-btn-apply")!);
    });

    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    const response = sent.find((m) => m.command === "confirmationResponse");
    expect(response).toBeDefined();
    const message = JSON.parse(response.decision.message);
    expect(message["多选：哪些模块？"]).toEqual(["客户档案"]);
  });

  it("multi-select: submits both options and the custom answer", async () => {
    const { vscode } = renderChatApp();
    showAskUser([
      {
        question: "多选：哪些模块？",
        options: [{ label: "客户档案" }, { label: "合同管理" }],
        multiSelect: true,
      },
    ]);
    await waitForDialog();

    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="checkbox"]',
        )!,
      );
    });
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    act(() => {
      fireEvent.change(document.querySelector(".other-text-input")!, {
        target: { value: "数据看板" },
      });
    });

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(document.querySelector(".confirmation-btn-apply")!);
    });

    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    const response = sent.find((m) => m.command === "confirmationResponse");
    expect(response).toBeDefined();
    const message = JSON.parse(response.decision.message);
    expect(message["多选：哪些模块？"]).toEqual(["客户档案", "数据看板"]);
  });

  it("multi-question: answering q1 enables 下一个 without other input interference", async () => {
    renderChatApp();
    showAskUser([
      ...singleQuestion,
      {
        question: "第二个问题：选择语言？",
        options: [{ label: "TypeScript" }, { label: "Python" }],
        multiSelect: false,
      },
    ]);
    await waitForDialog();

    // q1: select 方案 A
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });

    // 下一个 must be enabled (answer intact) and the textarea must not exist
    const nextBtn = document.querySelector(
      ".confirmation-btn-secondary",
    ) as HTMLButtonElement;
    expect(nextBtn).toBeInTheDocument();
    expect(nextBtn.disabled).toBe(false);
    expect(document.querySelector(".other-text-input")).not.toBeInTheDocument();

    // Navigate to q2
    act(() => {
      fireEvent.click(nextBtn);
    });
    await waitFor(() => {
      expect(document.querySelector(".question-header-chip")).toHaveTextContent(
        "第二个问题",
      );
    });
  });

  it("should focus the other textarea when Other is selected (mouse or Space)", async () => {
    renderChatApp();
    showAskUser(singleQuestion);
    await waitForDialog();

    // Mouse: clicking the Other radio reveals and focuses the textarea
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(document.activeElement).toHaveClass("other-text-input");

    // Switch back to a normal option: textarea hides again
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });
    await waitFor(() => {
      expect(
        document.querySelector(".other-text-input"),
      ).not.toBeInTheDocument();
    });

    // Keyboard: selecting Other with Space focuses the textarea
    act(() => {
      fireEvent.keyDown(document.querySelector(".other-option")!, {
        key: " ",
      });
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(document.activeElement).toHaveClass("other-text-input");
  });

  it("multi-select: checking Other focuses the textarea", async () => {
    renderChatApp();
    showAskUser([
      {
        question: "多选：选择语言？",
        options: [{ label: "TypeScript" }, { label: "Python" }],
        multiSelect: true,
      },
    ]);
    await waitForDialog();

    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="checkbox"]')!,
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".other-text-input")).toBeInTheDocument();
    });
    expect(document.activeElement).toHaveClass("other-text-input");
  });

  it("should not steal focus when switching to a question that already has Other selected", async () => {
    renderChatApp();
    showAskUser([
      ...singleQuestion,
      {
        question: "第二个问题：选择语言？",
        options: [{ label: "TypeScript" }, { label: "Python" }],
        multiSelect: false,
      },
    ]);
    await waitForDialog();

    // q1: answer with a normal option so navigation is enabled
    act(() => {
      fireEvent.click(
        document.querySelector(
          '.option-item[data-option-index="0"] input[type="radio"]',
        )!,
      );
    });

    // Go to q2 and select Other -> textarea focuses
    act(() => {
      fireEvent.click(document.querySelector(".confirmation-btn-secondary")!);
    });
    act(() => {
      fireEvent.click(
        document.querySelector('.other-option input[type="radio"]')!,
      );
    });
    await waitFor(() => {
      expect(document.activeElement).toHaveClass("other-text-input");
    });

    // Simulate a real user: go back to q1, then forward to q2 again.
    // Focus must not jump into the textarea.
    const prevBtn = document.querySelector(
      '.question-progress-nav[aria-label="上一题"]',
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(prevBtn);
    });
    await waitFor(() => {
      expect(document.querySelector(".question-header-chip")).toHaveTextContent(
        "单选：选哪个方案？",
      );
    });
    const nextBtn = document.querySelector(
      '.question-progress-nav[aria-label="下一题"]',
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(nextBtn);
    });
    await waitFor(() => {
      expect(document.querySelector(".question-header-chip")).toHaveTextContent(
        "第二个问题",
      );
    });
    expect(document.activeElement).not.toHaveClass("other-text-input");
  });

  describe("AskUserQuestion option group roving + modal focus trap", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const showAskUser = (questions: unknown[]) => {
      act(() => {
        sendCommand("showConfirmation", {
          confirmationId: "ask-user-roving",
          toolName: ASK_USER_QUESTION_TOOL_NAME,
          confirmationType: "需要确认",
          toolInput: { questions },
        });
      });
    };

    const twoOptionQuestion = [
      {
        question: "选哪个方案？",
        options: [{ label: "方案 A" }, { label: "方案 B" }],
        multiSelect: false,
      },
    ];

    const optionLabels = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".option-item"));

    it("opens with focus on the option group's single Tab stop", async () => {
      renderChatApp();
      showAskUser(twoOptionQuestion);
      await waitFor(() => {
        expect(
          document.querySelector(".confirmation-dialog"),
        ).toBeInTheDocument();
      });
      // Exactly one option label holds the Tab stop (the first by default).
      const labels = optionLabels();
      expect(labels.filter((l) => l.tabIndex === 0).length).toBe(1);
      expect(labels[0].tabIndex).toBe(0);
      expect(document.activeElement).toBe(labels[0]);
    });

    it("Arrow keys move focus within the group, clamping at the ends", async () => {
      renderChatApp();
      showAskUser(twoOptionQuestion);
      await waitFor(() => {
        expect(
          document.querySelector(".confirmation-dialog"),
        ).toBeInTheDocument();
      });
      const labels = optionLabels();
      act(() => {
        fireEvent.keyDown(labels[0], { key: "ArrowDown" });
      });
      expect(document.activeElement).toBe(labels[1]);
      expect(labels[1].tabIndex).toBe(0);
      expect(labels[0].tabIndex).toBe(-1);
      // ArrowDown past the last option ("Other") clamps there.
      act(() => {
        fireEvent.keyDown(labels[1], { key: "ArrowDown" });
      });
      const other = document.querySelector<HTMLElement>(".other-option")!;
      expect(document.activeElement).toBe(other);
      // ArrowDown again clamps (stays on "Other").
      act(() => {
        fireEvent.keyDown(other, { key: "ArrowDown" });
      });
      expect(document.activeElement).toBe(other);
      // ArrowUp returns to the previous option.
      act(() => {
        fireEvent.keyDown(other, { key: "ArrowUp" });
      });
      expect(document.activeElement).toBe(labels[1]);
    });

    it("Space on the focused option selects it; selection survives focus moves", async () => {
      renderChatApp();
      showAskUser(twoOptionQuestion);
      await waitFor(() => {
        expect(
          document.querySelector(".confirmation-dialog"),
        ).toBeInTheDocument();
      });
      const labels = optionLabels();
      act(() => {
        fireEvent.keyDown(labels[1], { key: "ArrowUp" });
      });
      act(() => {
        fireEvent.keyDown(labels[0], { key: " " });
      });
      expect(
        document.querySelector('.option-item[data-option-index="0"] input')!,
      ).toBeChecked();
      // Moving focus away and back keeps the roving position.
      act(() => {
        fireEvent.keyDown(labels[0], { key: "ArrowDown" });
      });
      expect(document.activeElement).toBe(labels[1]);
      act(() => {
        fireEvent.keyDown(labels[1], { key: "ArrowUp" });
      });
      expect(document.activeElement).toBe(labels[0]);
      expect(labels[0].tabIndex).toBe(0);
    });

    it("Tab cycles inside the dialog (modal trap): last element wraps to first", async () => {
      renderChatApp();
      showAskUser(twoOptionQuestion);
      await waitFor(() => {
        expect(
          document.querySelector(".confirmation-dialog"),
        ).toBeInTheDocument();
      });
      const dialog = document.querySelector(".confirmation-dialog")!;
      // With the question unanswered the only enabled focusables are the
      // roving option label and the close button (nav + submit disabled).
      const enabled = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.tabIndex !== -1);
      const first = enabled[0];
      const last = enabled[enabled.length - 1];
      expect(enabled.length).toBe(2);

      // Tab from the last wraps to the first.
      last.focus();
      act(() => {
        fireEvent.keyDown(window, { key: "Tab" });
      });
      expect(document.activeElement).toBe(first);
      // Shift+Tab from the first wraps to the last.
      first.focus();
      act(() => {
        fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
      });
      expect(document.activeElement).toBe(last);
      // Wrapping again keeps focus inside the dialog.
      act(() => {
        fireEvent.keyDown(window, { key: "Tab" });
      });
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("dismissing restores focus to the element focused before the dialog", async () => {
      renderChatApp();
      const input = document.querySelector<HTMLElement>(
        '[data-testid="message-input"]',
      )!;
      act(() => {
        input.focus();
      });
      showAskUser(twoOptionQuestion);
      await waitFor(() => {
        expect(
          document.querySelector(".confirmation-dialog"),
        ).toBeInTheDocument();
      });
      expect(document.activeElement).not.toBe(input);
      act(() => {
        fireEvent.click(document.querySelector(".confirmation-close-btn")!);
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
      });
    });

    it("switching to the next question moves focus to its option group (never drops to body)", async () => {
      renderChatApp();
      showAskUser([
        {
          question: "Q1",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
        },
        {
          question: "Q2",
          options: [{ label: "C" }, { label: "D" }],
          multiSelect: false,
        },
      ]);
      await waitFor(() => {
        expect(
          document.querySelector(".confirmation-dialog"),
        ).toBeInTheDocument();
      });

      // Answer Q1 (the "下一个" button becomes enabled).
      act(() => {
        fireEvent.click(
          document.querySelector(
            '.option-item[data-option-index="0"] input[type="radio"]',
          )!,
        );
      });
      // Click "下一个": the nav button the user is on becomes disabled on the
      // unanswered Q2, which would drop focus to body — focus must instead
      // land on Q2's roving option so the user can keep answering.
      act(() => {
        fireEvent.click(
          document.querySelector(
            ".question-navigation .confirmation-btn-secondary",
          )!,
        );
      });
      await waitFor(() => {
        expect(
          document.querySelector(".question-header-chip"),
        ).toHaveTextContent("Q2");
      });
      expect(document.activeElement).toHaveClass("option-item");
      expect(document.activeElement?.textContent).toContain("C");
    });
  });
});
