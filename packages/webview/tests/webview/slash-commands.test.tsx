import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";

/**
 * Helper: set contenteditable text, set up selection inside a text node at end,
 * and fire input event.
 *
 * handleSlashCommandSelect/handleFileSelect check `textNode.nodeType ===
 * Node.TEXT_NODE` — if the selection sits on the div itself (nodeType=1), they
 * skip. So the helper has to put the selection inside a Text node rather than
 * rely on whatever range `textContent = …` happens to leave behind.
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  const existing = input.textContent || "";
  const fullText = existing + text;
  input.textContent = fullText;

  // Set selection at end of the text node (not on the div)
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

describe("Slash Commands", () => {
  // The dropdown request is debounced (200ms) after the selection change, so
  // every case's real subject is "eventually the popup shows up". Freeze the
  // clock and let Vitest drive it (`nextTimerAsync` chains the debounce timer
  // to the state update back to back). Only the timer APIs are faked: the tree
  // is a real ChatApp under real Chromium, so rAF/layout must keep running.
  // `vi.waitFor` (not Testing Library's) advances a fake clock; RTL's does not.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.setTimerTickMode("nextTimerAsync");
  });
  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it("should insert slash command with a space when selected via Enter", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    // Type '/' to trigger slash commands
    await typeInInput("/");

    // Verify requestSlashCommands was sent (debounced 150ms)
    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    // Simulate response from extension
    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "init", name: "init", description: "Initialize repository" },
        { id: "help", name: "help", description: "Show help" },
      ],
    });

    // Verify popup is visible
    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    // Press Enter to select the first command (init)
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Verify popup is closed
    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("slash-commands-popup"),
      ).not.toBeInTheDocument();
    });

    // Verify input content (should be "/init" with trailing space in textContent)
    await vi.waitFor(() => {
      expect(input.textContent?.trim()).toBe("/init");
    });
    expect(input.textContent).toBe("/init ");
  });

  it("should insert slash command correctly after existing text", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    // Type "hello " then "/"
    await typeInInput("hello ");
    await typeInInput("/");

    // Wait for requestSlashCommands
    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    // Simulate response
    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "init", name: "init", description: "Initialize repository" },
      ],
    });

    // Wait for popup
    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    // Select command
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Verify content
    await vi.waitFor(() => {
      expect(input.textContent?.trim()).toBe("hello /init");
    });
    expect(input.textContent).toBe("hello /init ");
  });

  it("should insert slash command with Tab key", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/");

    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "init", name: "init", description: "Initialize repository" },
        { id: "help", name: "help", description: "Show help" },
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    // Press Tab to select the first command
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab" });
    });

    // Verify popup is closed
    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("slash-commands-popup"),
      ).not.toBeInTheDocument();
    });

    await vi.waitFor(() => {
      expect(input.textContent?.trim()).toBe("/init");
    });
    expect(input.textContent).toBe("/init ");
  });

  it("should insert slash command when clicked with mouse", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/");

    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "init", name: "init", description: "Initialize repository" },
        { id: "help", name: "help", description: "Show help" },
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    // Click the first command item with mouse
    const cmdItem = screen.getByTestId("slash-command-init");
    await act(async () => {
      fireEvent.mouseDown(cmdItem);
    });

    // Verify popup is closed
    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("slash-commands-popup"),
      ).not.toBeInTheDocument();
    });

    await vi.waitFor(() => {
      expect(input.textContent?.trim()).toBe("/init");
    });
    expect(input.textContent).toBe("/init ");
  });

  it("should insert a skill command on mouse click even when selection is on the div", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/");

    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        { id: "init", name: "init", description: "Initialize repository" },
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    // Real browsers sometimes leave the selection collapsed on the contenteditable
    // div (nodeType 1) rather than a text node after the slash is typed — the same
    // mouse-click condition c3404d38 fixed for local commands. Skill commands still
    // silently no-op here, so the first click fails to insert anything (the user
    // has to type '/' again to make the second click work).
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const cmdItem = screen.getByTestId("slash-command-init");
    await act(async () => {
      fireEvent.mouseDown(cmdItem);
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("slash-commands-popup"),
      ).not.toBeInTheDocument();
    });

    // The skill command must be inserted on the first click (currently the input
    // stays '/').
    await vi.waitFor(() => {
      expect(input.textContent?.trim()).toBe("/init");
    });
    expect(input.textContent).toBe("/init ");
  });

  it("should open the local command dialog when clicked even if selection is on the div", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/plugin");

    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        {
          id: "plugin",
          name: "plugin",
          description: "插件市场",
          runOnSelect: true,
        },
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    // Simulate a mouse click: the selection is no longer inside the input's
    // text node (it collapses onto the contenteditable div, nodeType 1),
    // which used to make handleSlashCommandSelect silently no-op.
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const cmdItem = screen.getByTestId("slash-command-plugin");
    await act(async () => {
      fireEvent.mouseDown(cmdItem);
    });

    // 不再弹窗：/plugin 唤起设置页并选中「插件市场」选项卡（对齐 /mcp、/skills）。
    await vi.waitFor(() => {
      const call = vscode.postMessage.mock.calls.find(
        (c) => c[0]?.command === "openSettings",
      );
      expect(call?.[0]?.nav).toBe("plugins");
    });

    // Popup closed and input cleared.
    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("slash-commands-popup"),
      ).not.toBeInTheDocument();
    });
    expect(input.textContent).toBe("");
  });

  it("should execute a command flagged runOnSelect instead of inserting its name", async () => {
    // 判据是宿主随命令下发的 `runOnSelect`，不是任何命令名名单：这里故意用一个
    // 任何宿主/弹窗都不认识的名字，选中后仍应走「发回宿主」分支。
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("/my-view");

    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    sendCommand("slashCommandsResponse", {
      commands: [
        {
          id: "my-view",
          name: "my-view",
          description: "宿主自定义视图",
          runOnSelect: true,
        },
      ],
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "sendMessage", text: "/my-view" }),
      );
    });
    // 走的是「执行」分支：命令名不会被插回输入框等参数。
    expect(input.textContent).toBe("");
  });

  it("should filter slash commands as user types", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    // Type '/h'
    await typeInInput("/h");

    await vi.waitFor(
      () => {
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: "requestSlashCommands" }),
        );
      },
      { timeout: 3000 },
    );

    // Simulate response with filtered commands
    sendCommand("slashCommandsResponse", {
      commands: [{ id: "help", name: "help", description: "Show help" }],
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("slash-commands-popup")).toBeInTheDocument();
    });

    const popup = screen.getByTestId("slash-commands-popup");
    expect(popup).toHaveTextContent("/help");
    expect(popup).not.toHaveTextContent("/init");
  });
});
