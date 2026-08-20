import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderChatApp, screen, waitFor, act, sendCommand } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

describe("Task Notification Block Hidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not render completed task notification in message flow", async () => {
    renderChatApp();

    const message =
      MockDataGenerator.createAssistantMessageWithTaskNotification(
        "Background task completed:",
        "task-1",
        "shell",
        "completed",
        "npm test passed with 42 tests",
        "/tmp/test-output.log",
      );

    act(() => {
      sendCommand("updateMessages", { messages: [message] });
    });

    // The text block renders normally, but the task notification is hidden
    await waitFor(() => {
      expect(
        screen.getByText("Background task completed:"),
      ).toBeInTheDocument();
    });

    expect(document.querySelector(".task-notification-block")).toBeNull();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(
      screen.queryByText("npm test passed with 42 tests"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("输出: /tmp/test-output.log"),
    ).not.toBeInTheDocument();
  });

  it("should not render failed task notification in message flow", async () => {
    renderChatApp();

    const message =
      MockDataGenerator.createAssistantMessageWithTaskNotification(
        "",
        "task-2",
        "agent",
        "failed",
        "Explore agent encountered an error during file analysis",
      );

    act(() => {
      sendCommand("updateMessages", { messages: [message] });
    });

    await waitFor(() => {
      expect(document.querySelector(".task-notification-block")).toBeNull();
    });

    expect(screen.queryByText("失败")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Explore agent encountered an error during file analysis",
      ),
    ).not.toBeInTheDocument();
  });

  it("should not render killed task notification in message flow", async () => {
    renderChatApp();

    const message =
      MockDataGenerator.createAssistantMessageWithTaskNotification(
        "",
        "task-3",
        "shell",
        "killed",
        "Long-running process was terminated by user",
      );

    act(() => {
      sendCommand("updateMessages", { messages: [message] });
    });

    await waitFor(() => {
      expect(document.querySelector(".task-notification-block")).toBeNull();
    });

    expect(screen.queryByText("已终止")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Long-running process was terminated by user"),
    ).not.toBeInTheDocument();
  });

  it("should not render multiple task notifications in a single message", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessageWithTaskNotification(
        "",
        "task-completed",
        "shell",
        "completed",
        "Build succeeded",
      ),
      MockDataGenerator.createAssistantMessageWithTaskNotification(
        "",
        "task-failed",
        "agent",
        "failed",
        "Agent failed to connect",
      ),
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    await waitFor(() => {
      expect(
        document.querySelectorAll(".task-notification-block"),
      ).toHaveLength(0);
    });

    expect(screen.queryByText("Build succeeded")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Agent failed to connect"),
    ).not.toBeInTheDocument();
  });

  it("should handle task notification without summary or outputFile", async () => {
    renderChatApp();

    const message =
      MockDataGenerator.createAssistantMessageWithTaskNotification(
        "",
        "task-minimal",
        "agent",
        "completed",
      );

    act(() => {
      sendCommand("updateMessages", { messages: [message] });
    });

    await waitFor(() => {
      expect(document.querySelector(".task-notification-block")).toBeNull();
    });

    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  });
});
