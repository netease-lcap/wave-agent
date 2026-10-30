import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import type { Message } from "wave-agent-sdk";

/**
 * 助手消息上的「把本轮转到后台」按钮（spec:
 * multi-agent/task-background-execution.md「前台工具后台化」场景 3–6）。
 *
 * 三件事在这里钉住：出现条件（有运行中的 Bash/Agent、且长在最后一条消息上）、
 * 点击发的是与 Ctrl/Cmd+B 同一条命令、以及它与回滚按钮是同一颗按钮。
 */
describe("Background current task button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWith = (messages: Message[]) =>
    act(() => {
      sendCommand("updateMessages", { messages });
    });

  it("backgrounds the running turn when the button is clicked", async () => {
    const { vscode } = renderChatApp();

    renderWith([
      MockDataGenerator.createUserMessage("run it", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "running a build",
        "Bash",
        '{"command":"npm run build"}',
      ),
    ]);

    const button = await screen.findByTestId("background-current-task");
    vscode.postMessage.mockClear();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(
      vscode.postMessage.mock.calls
        .map((c) => c[0])
        .some((m) => m.command === "backgroundCurrentTask"),
    ).toBe(true);
  });

  it("appears for a running subagent too", async () => {
    renderChatApp();

    renderWith([
      MockDataGenerator.createUserMessage("delegate it", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "spawning a subagent",
        "Agent",
        '{"description":"explore"}',
      ),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId("background-current-task")).toBeInTheDocument();
    });
  });

  it("is absent once the tool finished", async () => {
    renderChatApp();

    renderWith([
      MockDataGenerator.createUserMessage("run it", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "done",
        "Bash",
        '{"command":"ls"}',
        "file.txt",
      ),
    ]);

    await waitFor(() => {
      expect(screen.getByText("done")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("background-current-task"),
    ).not.toBeInTheDocument();
  });

  it("is absent when the running tool cannot be backgrounded", async () => {
    renderChatApp();

    renderWith([
      MockDataGenerator.createUserMessage("read it", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "reading",
        "Read",
        '{"file_path":"/tmp/a.ts"}',
      ),
    ]);

    await waitFor(() => {
      expect(screen.getByText("reading")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("background-current-task"),
    ).not.toBeInTheDocument();
  });

  it("is absent on a message that is no longer the last one", async () => {
    renderChatApp();

    // 上面那条助手消息里仍挂着未收尾的 Bash 块（例如被中断的回合），但后面已经
    // 又来了新的用户消息 ⇒ 它不再代表「正在跑的这一轮」，不该给出入口。
    renderWith([
      MockDataGenerator.createAssistantMessageWithTool(
        "stale",
        "Bash",
        '{"command":"sleep 60"}',
      ),
      MockDataGenerator.createUserMessage("never mind", "msg-u2"),
    ]);

    await waitFor(() => {
      expect(screen.getByText("never mind")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("background-current-task"),
    ).not.toBeInTheDocument();
  });

  it("matches the rewind button's shape (same shared action button)", async () => {
    renderChatApp();

    renderWith([
      MockDataGenerator.createUserMessage("run it", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "running",
        "Bash",
        '{"command":"npm run build"}',
      ),
    ]);

    const background = await screen.findByTestId("background-current-task");
    const rewind = screen.getByTestId("rewind-to-message");

    // 同一套按钮：同一 className、同一容器、同一 aria 约定（spec 场景 6）。
    expect(background.className).toBe(rewind.className);
    expect(background.parentElement?.className).toBe(
      rewind.parentElement?.className,
    );
    expect(background.getAttribute("aria-label")).toBe("把本轮转到后台");
    expect(rewind.getAttribute("aria-label")).toBe("回滚到此消息");
  });
});
