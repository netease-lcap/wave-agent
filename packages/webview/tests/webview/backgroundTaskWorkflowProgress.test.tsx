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

/**
 * 运行详情本身：阶段/日志/失败/agent 列表/agent 卡片这一整套是 `WorkflowRunProgress`
 * 画的，原先由独立的工作流对话框承载测试，面板合并后这里就是它的唯一宿主
 * （spec `multi-agent/workflow`「工作流管理入口」与「查看单个 agent 的执行详情」）。
 */
describe("Workflow run detail in the task panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Activity requests the agent card posted, oldest first. */
  function postedActivityRequests(vscode: {
    postMessage: ReturnType<typeof vi.fn>;
  }) {
    return vscode.postMessage.mock.calls
      .map((call) => call[0] as { command?: string; requestId?: string })
      .filter(
        (message) => message.command === "getWorkflowAgentActivity",
      ) as Array<{
      requestId: string;
    }>;
  }

  function lastActivityRequest(vscode: {
    postMessage: ReturnType<typeof vi.fn>;
  }) {
    const posted = postedActivityRequests(vscode);
    return posted[posted.length - 1];
  }

  it("hides the phases and logs sections before either has content", () => {
    renderChatApp();
    openWorkflowTaskDetail([makeRun({ phases: [], totalAgents: 0 })]);

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent("Agents: 0");
    // An empty "Phases:" / "Logs:" block reads as missing data.
    expect(dialog).not.toHaveTextContent("Phases:");
    expect(dialog).not.toHaveTextContent("Logs:");
  });

  it("reports failures and the error of a failed run", () => {
    renderChatApp();
    openWorkflowTaskDetail([
      makeRun({
        status: "failed",
        endTime: BASE + 60000,
        error: "Agent #3 exceeded token budget and aborted",
        failures: ["pipeline[2] failed: 代理未返回结构化结果"],
      }),
    ]);
    // 任务那条记录跟着跑完：状态角标读的是任务，进度块读的是运行。
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [{ ...workflowTask, status: "failed" }],
      });
    });

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent(
      "Error: Agent #3 exceeded token budget and aborted",
    );
    expect(dialog).toHaveTextContent("Failures:");
    expect(dialog).toHaveTextContent(
      "pipeline[2] failed: 代理未返回结构化结果",
    );
    expect(dialog).toHaveTextContent("failed");
  });

  it("lists each started agent with its counters", () => {
    renderChatApp();
    openWorkflowTaskDetail([
      makeRun({
        agents: [
          {
            index: 0,
            label: "scout",
            agentType: "Explore",
            status: "completed",
            startTime: BASE,
            endTime: BASE + 42000,
            tokens: 12300,
            toolUses: 7,
          },
          {
            // No label: the row falls back to the agent type.
            index: 1,
            agentType: "general-purpose",
            status: "running",
            startTime: BASE,
          },
          {
            // A single tool use reads as "1 tool", not "1 tools".
            index: 2,
            label: "sum",
            status: "completed",
            startTime: BASE,
            endTime: BASE + 1000,
            toolUses: 1,
          },
        ],
      }),
    ]);

    const list = screen.getByTestId("workflow-agent-list");
    expect(list).toHaveTextContent("Agents:");
    // Fields in the spec's order: label, status, tokens, tool uses, duration —
    // zero counts are dropped rather than rendered as "0 tools".
    expect(screen.getByTestId("workflow-agent-row-0")).toHaveTextContent(
      "#1 scout completed · 12.3k tokens · 7 tools · 42s",
    );
    expect(screen.getByTestId("workflow-agent-row-1")).toHaveTextContent(
      "#2 general-purpose running",
    );
    // A running agent has no end time, so it claims no duration.
    expect(screen.getByTestId("workflow-agent-row-1")).not.toHaveTextContent(
      "0ms",
    );
    expect(screen.getByTestId("workflow-agent-row-2")).toHaveTextContent(
      /· 1 tool ·/,
    );
  });

  it("drops the agent block when the run started none", () => {
    renderChatApp();
    openWorkflowTaskDetail([makeRun({ agents: [] })]);

    expect(screen.queryByTestId("workflow-agent-list")).toBeNull();
  });

  it("opens an agent card with its prompt, activity and outcome", () => {
    const { vscode } = renderChatApp();
    openWorkflowTaskDetail([
      makeRun({
        agents: [
          {
            index: 0,
            label: "scout",
            agentType: "Explore",
            status: "completed",
            startTime: BASE,
            endTime: BASE + 42000,
            tokens: 12300,
            toolUses: 7,
            promptPreview: "阅读 src/workflow 下的实现并总结",
            resultPreview: "共 5 个文件，无循环依赖",
          },
        ],
      }),
    ]);

    fireEvent.click(screen.getByTestId("workflow-agent-row-0"));

    // The card replaces the run detail: one panel, one layer.
    expect(screen.queryByText(/Run ID:/)).toBeNull();
    expect(screen.getByText(/Agent #1/)).toHaveTextContent(
      "Agent #1 · scout · completed",
    );
    expect(screen.getByText("Prompt:")).toBeInTheDocument();
    expect(
      screen.getByText("阅读 src/workflow 下的实现并总结"),
    ).toBeInTheDocument();
    expect(screen.getByText("Outcome:")).toBeInTheDocument();
    expect(screen.getByText("共 5 个文件，无循环依赖")).toBeInTheDocument();

    // The activity is whatever the host answered for the request the card made.
    const request = vscode.postMessage.mock.calls
      .map((call) => call[0] as { command?: string; requestId?: string })
      .find((message) => message.command === "getWorkflowAgentActivity");
    expect(request).toMatchObject({ runId: RUN_ID, agentIndex: 0 });

    act(() => {
      sendCommand("workflowAgentActivity", {
        requestId: request!.requestId,
        runId: RUN_ID,
        agentIndex: 0,
        activity: "[2026-01-01T00:00:00.000Z] Read a.ts\nAgent completed",
      });
    });
    const activity = screen.getByTestId("workflow-agent-activity");
    expect(activity).toHaveTextContent("Read a.ts");
    expect(activity).toHaveTextContent("Agent completed");

    // Back returns to the run detail it came from.
    fireEvent.click(screen.getByTestId("workflow-agent-back"));
    expect(screen.getByText(/Run ID:/)).toBeInTheDocument();
  });

  it("keeps the newest activity reply and drops a stale one", () => {
    const { vscode } = renderChatApp();
    openWorkflowTaskDetail([
      makeRun({
        agents: [
          { index: 0, status: "running", startTime: BASE },
          { index: 1, status: "running", startTime: BASE },
        ],
      }),
    ]);

    fireEvent.click(screen.getByTestId("workflow-agent-row-0"));
    const first = lastActivityRequest(vscode)!;
    fireEvent.click(screen.getByTestId("workflow-agent-back"));
    fireEvent.click(screen.getByTestId("workflow-agent-row-1"));
    const second = lastActivityRequest(vscode)!;
    expect(second.requestId).not.toBe(first.requestId);

    // The answer for agent #1 arrives after the user moved to #2: it must not
    // be painted onto the card that is open now.
    act(() => {
      sendCommand("workflowAgentActivity", {
        requestId: first.requestId,
        runId: RUN_ID,
        agentIndex: 0,
        activity: "stale line from agent 1",
      });
      sendCommand("workflowAgentActivity", {
        requestId: second.requestId,
        runId: RUN_ID,
        agentIndex: 1,
        activity: "fresh line from agent 2",
      });
    });

    const activity = screen.getByTestId("workflow-agent-activity");
    expect(activity).toHaveTextContent("fresh line from agent 2");
    expect(activity).not.toHaveTextContent("stale line from agent 1");
  });

  it("re-reads the activity of a running agent on the polling cadence and stops at a terminal state", () => {
    vi.useFakeTimers();
    try {
      const { vscode } = renderChatApp();
      openWorkflowTaskDetail([
        makeRun({ agents: [{ index: 0, status: "running", startTime: BASE }] }),
      ]);

      fireEvent.click(screen.getByTestId("workflow-agent-row-0"));
      expect(postedActivityRequests(vscode)).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(POLL_MS);
      });
      expect(postedActivityRequests(vscode)).toHaveLength(2);

      // The run snapshot flips the agent to completed: one last read lands and
      // the cadence stops (polling a terminal agent only costs frames).
      act(() => {
        sendCommand("updateWorkflowRuns", {
          runs: [
            makeRun({
              agents: [
                {
                  index: 0,
                  status: "completed",
                  startTime: BASE,
                  endTime: BASE + 1000,
                },
              ],
            }),
          ],
        });
      });
      const afterTerminal = postedActivityRequests(vscode).length;
      act(() => {
        vi.advanceTimersByTime(POLL_MS * 3);
      });
      expect(postedActivityRequests(vscode)).toHaveLength(afterTerminal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spells out the scale of an oversized run in the detail", () => {
    renderChatApp();
    // 26 agents / 6.3M tokens — past both thresholds. The host derives
    // `sizeWarning` when it hands the snapshot over, so the webview only renders.
    openWorkflowTaskDetail([
      makeRun({
        totalAgents: 26,
        totalTokens: 6_300_000,
        sizeWarning: true,
      }),
    ]);

    const marker = screen.getByTestId("workflow-oversized");
    expect(marker).toHaveTextContent("运行过大：26 agents / 6.3M tokens");
    expect(marker).toHaveTextContent("越过阈值 25 agents / 1.5M tokens");
    // The model is never told, so the line has to say what to do about it — via
    // this dialog's own stop button, not by pointing at another panel.
    expect(marker).toHaveTextContent("运行中，可点「停止」按钮中止");
  });

  it("drops the stop hint for an oversized run that already ended", () => {
    renderChatApp();
    openWorkflowTaskDetail([
      makeRun({
        status: "completed",
        endTime: BASE + 60000,
        totalAgents: 26,
        totalTokens: 6_300_000,
        sizeWarning: true,
      }),
    ]);

    // Nothing left to stop, so the marker only reports the size.
    const marker = screen.getByTestId("workflow-oversized");
    expect(marker).toHaveTextContent("越过阈值 25 agents / 1.5M tokens");
    expect(marker).not.toHaveTextContent("停止");
  });

  it("stops the run from the task detail by its task id", () => {
    const { vscode } = renderChatApp();
    openWorkflowTaskDetail([makeRun()]);

    // 停止落在后台任务那一条命令上（任务 id 即 runId），不是另一条工作流专属的
    // 停止通道：合并后只有一个承载，也只有一个停止入口。
    fireEvent.click(screen.getByText("停止"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "stopBackgroundTask",
      taskId: RUN_ID,
    });
    expect(screen.getByText("停止中...")).toBeDisabled();
  });
});
