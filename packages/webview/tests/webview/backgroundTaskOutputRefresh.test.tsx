import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const POLL_MS = 1500;

function runningOutput(taskId: string, stdout: string) {
  return {
    command: "backgroundTaskOutput",
    taskId,
    output: { stdout, stderr: "", status: "running", type: "shell" },
  };
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

describe("Background task detail live refresh while running", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls a running task's output and renders the newer tail", () => {
    // The SDK answers with the task's log-file tail while it runs, so the
    // panel must keep re-reading instead of freezing on the first snapshot.
    const { vscode } = renderChatApp();
    openTasksDialog();

    fireEvent.click(screen.getByText("[bg-1] shell"));
    expect(outputRequests(vscode)).toHaveLength(1);

    act(() => {
      sendCommand("backgroundTaskOutput", runningOutput("bg-1", "step 1"));
    });

    act(() => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(outputRequests(vscode)).toHaveLength(2);

    act(() => {
      sendCommand(
        "backgroundTaskOutput",
        runningOutput("bg-1", "step 1\nstep 2"),
      );
    });
    expect(screen.getByTestId("background-task-manager")).toHaveTextContent(
      "step 2",
    );
  });

  it("stops polling once the task reaches a terminal state", () => {
    const { vscode } = renderChatApp();
    openTasksDialog();

    fireEvent.click(screen.getByText("[bg-1] shell"));
    act(() => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(outputRequests(vscode)).toHaveLength(2);

    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [completedTask] });
    });
    const afterTerminal = outputRequests(vscode).length;

    act(() => {
      vi.advanceTimersByTime(POLL_MS * 5);
    });
    expect(outputRequests(vscode)).toHaveLength(afterTerminal);
  });

  it("does not poll a task that already finished when the detail view opens", () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [completedTask] });
    });
    act(() => {
      sendCommand("showDialog", { dialogType: "tasks" });
    });

    fireEvent.click(screen.getByText("[bg-1] shell"));
    const afterOpen = outputRequests(vscode).length;

    act(() => {
      vi.advanceTimersByTime(POLL_MS * 5);
    });
    expect(outputRequests(vscode)).toHaveLength(afterOpen);
  });

  it("ignores a late reply for a previously selected task", () => {
    const secondTask: BackgroundTaskSummary = {
      id: "bg-2",
      type: "shell",
      status: "running",
      startTime: 2000,
      command: "npm test",
    };
    renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [runningTask, secondTask],
      });
    });
    act(() => {
      sendCommand("showDialog", { dialogType: "tasks" });
    });

    fireEvent.click(screen.getByText("[bg-1] shell"));
    // Back to the list, then open the other task: bg-1's request is now stale.
    fireEvent.click(screen.getByText("返回列表"));
    fireEvent.click(screen.getByText("[bg-2] shell"));

    // bg-1's answer lands after the switch: it must not overwrite bg-2.
    act(() => {
      sendCommand("backgroundTaskOutput", runningOutput("bg-1", "stale bg-1"));
    });
    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).not.toHaveTextContent("stale bg-1");

    act(() => {
      sendCommand("backgroundTaskOutput", runningOutput("bg-2", "fresh bg-2"));
    });
    expect(dialog).toHaveTextContent("fresh bg-2");
  });
});
