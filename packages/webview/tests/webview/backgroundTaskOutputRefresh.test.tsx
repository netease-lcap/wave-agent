import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  fireEvent,
  sendCommand,
} from "./test-utils";
import type { BackgroundTaskSummary } from "../../src/types";

const runningTask: BackgroundTaskSummary = {
  id: "bg-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "npm run build",
  description: "long-running build",
};

const completedTask: BackgroundTaskSummary = {
  ...runningTask,
  status: "completed",
  runtime: 5000,
  exitCode: 0,
};

/** Number of getBackgroundTaskOutput requests the webview has sent. */
function outputRequests(vscode: { postMessage: ReturnType<typeof vi.fn> }) {
  const calls = vscode.postMessage.mock.calls as Array<[{ command?: string }]>;
  return calls.filter((c) => c[0]?.command === "getBackgroundTaskOutput");
}

function openTasksDialog() {
  act(() => {
    sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
  });
  act(() => {
    sendCommand("showDialog", { dialogType: "tasks" });
  });
}

describe("Background task detail output refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refetches output when the selected task reaches a terminal state", () => {
    // Repro: open the detail view of a running task. The host answers with an
    // output object whose stdout is empty (subagent/shell tasks only fill
    // stdout on a terminal snapshot). When the task later completes, the panel
    // must refetch — otherwise it keeps showing "(无输出)" forever.
    const { vscode } = renderChatApp();
    openTasksDialog();

    fireEvent.click(screen.getByText("[bg-1] shell"));
    expect(outputRequests(vscode)).toHaveLength(1);

    act(() => {
      sendCommand("backgroundTaskOutput", {
        taskId: "bg-1",
        output: { stdout: "", stderr: "", status: "running", type: "shell" },
      });
    });
    expect(screen.getByTestId("background-task-manager")).toHaveTextContent(
      "(无输出)",
    );

    // Task finishes: the host broadcasts the terminal snapshot.
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [completedTask] });
    });

    expect(outputRequests(vscode)).toHaveLength(2);

    act(() => {
      sendCommand("backgroundTaskOutput", {
        taskId: "bg-1",
        output: {
          stdout: "✓ built in 3.2s",
          stderr: "",
          status: "completed",
          type: "shell",
        },
      });
    });
    expect(screen.getByTestId("background-task-manager")).toHaveTextContent(
      "✓ built in 3.2s",
    );
  });

  it("does not refetch while the status is unchanged (no request loop)", () => {
    const { vscode } = renderChatApp();
    openTasksDialog();

    fireEvent.click(screen.getByText("[bg-1] shell"));
    act(() => {
      sendCommand("backgroundTaskOutput", {
        taskId: "bg-1",
        output: { stdout: "", stderr: "", status: "running", type: "shell" },
      });
    });

    // Repeated broadcasts carrying the same status must not trigger a refetch.
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [{ ...runningTask }] });
    });
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [{ ...runningTask }] });
    });

    expect(outputRequests(vscode)).toHaveLength(1);
  });

  it("fetches once when a completed task is opened after it finished", () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [completedTask] });
    });
    act(() => {
      sendCommand("showDialog", { dialogType: "tasks" });
    });

    fireEvent.click(screen.getByText("[bg-1] shell"));
    expect(outputRequests(vscode)).toHaveLength(1);

    act(() => {
      sendCommand("backgroundTaskOutput", {
        taskId: "bg-1",
        output: {
          stdout: "✓ built in 3.2s",
          stderr: "",
          status: "completed",
          type: "shell",
        },
      });
    });

    expect(screen.getByTestId("background-task-manager")).toHaveTextContent(
      "✓ built in 3.2s",
    );
    expect(outputRequests(vscode)).toHaveLength(1);
  });
});
