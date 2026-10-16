import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  fireEvent,
  sendCommand,
} from "./test-utils";
import type {
  BackgroundTaskSummary,
  SerializableWorkflowRun,
} from "../../src/types";

/**
 * A workflow's background task id IS its run id, so `/tasks` can show the same
 * structured progress `/workflows` does — the run one, not a text tail the
 * workflow never writes (spec `multi-agent/workflow`「在后台任务面板里看到工作流进度」).
 */
const RUN_ID = "wf_abc12345";
const BASE = 1_000;
const POLL_MS = 1500;

const workflowTask: BackgroundTaskSummary = {
  id: RUN_ID,
  type: "workflow",
  status: "running",
  startTime: BASE,
  description: "Workflow: audit-and-fix",
};

function makeRun(
  overrides: Partial<SerializableWorkflowRun> = {},
): SerializableWorkflowRun {
  return {
    runId: RUN_ID,
    meta: { name: "audit-and-fix", description: "审查并修复测试与类型错误" },
    status: "running",
    scriptPath: `/runs/${RUN_ID}/script.js`,
    startTime: BASE,
    phases: [
      {
        title: "Scan",
        agentCount: 4,
        tokens: 18500,
        elapsed: 45000,
        startTime: BASE,
      },
    ],
    totalAgents: 4,
    totalTokens: 18500,
    ...overrides,
  };
}

function outputRequests(vscode: { postMessage: ReturnType<typeof vi.fn> }) {
  const calls = vscode.postMessage.mock.calls as Array<[{ command?: string }]>;
  return calls.filter((c) => c[0]?.command === "getBackgroundTaskOutput");
}

function openWorkflowTaskDetail(runs?: SerializableWorkflowRun[]) {
  act(() => {
    sendCommand("updateBackgroundTasks", { tasks: [workflowTask] });
    if (runs) sendCommand("updateWorkflowRuns", { runs });
  });
  act(() => {
    sendCommand("showDialog", { dialogType: "tasks" });
  });
  fireEvent.click(screen.getByText(`[${RUN_ID}] workflow`));
}

describe("Workflow progress in the task panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the run's progress instead of an empty output box", () => {
    renderChatApp();
    openWorkflowTaskDetail([
      makeRun({
        logs: ["phase() Scan 开始", "grep 测试日志：找到 2 个重试用例"],
      }),
    ]);

    const dialog = screen.getByTestId("background-task-manager");
    // Progress, not "(无输出)": the workflow writes no text output file.
    expect(dialog).toHaveTextContent("Phases:");
    expect(dialog).toHaveTextContent("Scan");
    expect(dialog).toHaveTextContent("Agents: 4");
    expect(dialog).toHaveTextContent("18.5k tokens");
    expect(dialog).toHaveTextContent("Logs:");
    expect(dialog).toHaveTextContent("grep 测试日志：找到 2 个重试用例");
    expect(dialog).toHaveTextContent(`Script: /runs/${RUN_ID}/script.js`);

    expect(dialog).not.toHaveTextContent("OUTPUT (last 20 lines):");
    expect(dialog).not.toHaveTextContent("(无输出)");
  });

  it("renders progress for a run that never calls log()", () => {
    // The `phase()`-only shape used to leave the panel blank: phases are the
    // progress, and they do not depend on script logs.
    renderChatApp();
    openWorkflowTaskDetail([makeRun({ logs: [] })]);

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent("Phases:");
    expect(dialog).toHaveTextContent("Scan");
    expect(dialog).not.toHaveTextContent("Logs:");
  });

  it("falls back to the text output box when the run is no longer listed", () => {
    // The session may have moved on (`/clear`, a resumed session) while the task
    // entry survives — the detail must degrade, not go blank.
    const { vscode } = renderChatApp();
    openWorkflowTaskDetail();

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent("OUTPUT (last 20 lines):");
    expect(dialog).not.toHaveTextContent("Phases:");

    act(() => {
      sendCommand("backgroundTaskOutput", {
        taskId: RUN_ID,
        output: { stdout: "workflow aborted", stderr: "", status: "running" },
      });
    });
    expect(dialog).toHaveTextContent("workflow aborted");
    expect(outputRequests(vscode).length).toBeGreaterThan(0);
  });
});

describe("Workflow progress refresh in the task panel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the host's run pushes and does not poll the empty output", () => {
    const { vscode } = renderChatApp();
    openWorkflowTaskDetail([makeRun()]);

    const afterOpen = outputRequests(vscode).length;
    act(() => {
      vi.advanceTimersByTime(POLL_MS * 3);
    });
    // The run's progress arrives through updateWorkflowRuns, so the 1.5s output
    // poll has nothing to add — it would only ask for an output file that does
    // not exist.
    expect(outputRequests(vscode)).toHaveLength(afterOpen);

    act(() => {
      sendCommand("updateWorkflowRuns", {
        runs: [
          makeRun({
            phases: [
              {
                title: "Scan",
                agentCount: 4,
                tokens: 18500,
                elapsed: 45000,
                startTime: BASE,
              },
              {
                title: "Fix",
                agentCount: 3,
                tokens: 31200,
                elapsed: 75000,
                startTime: BASE + 45000,
              },
            ],
            totalAgents: 7,
            totalTokens: 49700,
            logs: ["agent #5 flaky.test.ts 修复完成，等待校验"],
          }),
        ],
      });
    });

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent("Fix");
    expect(dialog).toHaveTextContent("Agents: 7");
    expect(dialog).toHaveTextContent(
      "agent #5 flaky.test.ts 修复完成，等待校验",
    );
  });

  it("keeps the terminal result on screen when the run ends", () => {
    renderChatApp();
    openWorkflowTaskDetail([makeRun()]);

    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [{ ...workflowTask, status: "completed", runtime: 120000 }],
      });
      sendCommand("updateWorkflowRuns", {
        runs: [
          makeRun({
            status: "completed",
            endTime: BASE + 120000,
            totalAgents: 7,
            totalTokens: 49700,
          }),
        ],
      });
    });

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent("Phases:");
    expect(dialog).toHaveTextContent("Agents: 7");
    expect(dialog).not.toHaveTextContent("(无输出)");
  });
});
