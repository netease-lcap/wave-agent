import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  fireEvent,
  sendCommand,
} from "./test-utils";
import type { SerializableWorkflowRun } from "../../src/types";

const BASE = 1_000;

function makeRun(
  overrides: Partial<SerializableWorkflowRun> = {},
): SerializableWorkflowRun {
  return {
    runId: "wf_abc12345",
    meta: { name: "audit-and-fix", description: "审查并修复测试与类型错误" },
    status: "running",
    scriptPath: "/runs/wf_abc12345/script.js",
    startTime: BASE,
    phases: [],
    totalAgents: 0,
    totalTokens: 0,
    ...overrides,
  };
}

function openWorkflowsDialog(runs: SerializableWorkflowRun[]) {
  act(() => {
    sendCommand("updateWorkflowRuns", { runs });
  });
  act(() => {
    sendCommand("showDialog", { dialogType: "workflows" });
  });
}

describe("Workflow manager dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("labels each row with the workflow name, a status dot and its counts", () => {
    const { vscode } = renderChatApp();
    // Handed over oldest-first, the way the host's run map holds them: the
    // dialog has to reorder, not just render what it is given.
    openWorkflowsDialog([
      makeRun({
        runId: "wf_def67890",
        meta: { name: "migrate-config", description: "迁移配置到新格式" },
        status: "completed",
        startTime: BASE,
        endTime: BASE + 480000,
        totalAgents: 3,
        totalTokens: 31000,
      }),
      // Never started an agent: the counters are dropped rather than reported as
      // "0 agents · 0 tokens".
      makeRun({
        runId: "wf_ghi13579",
        meta: { name: "aborted-before-start", description: "启动即中止" },
        status: "aborted",
        startTime: BASE + 1000,
        endTime: BASE + 3000,
      }),
      makeRun({
        startTime: BASE + 500000,
        totalAgents: 7,
        totalTokens: 49700,
      }),
    ]);

    const dialog = screen.getByTestId("workflow-manager");
    expect(dialog).toHaveTextContent("audit-and-fix");
    expect(dialog).toHaveTextContent("migrate-config");
    expect(dialog).toHaveTextContent("aborted-before-start");

    // Newest first: the run just started is the one to look at.
    const rows = dialog.textContent ?? "";
    expect(rows.indexOf("audit-and-fix")).toBeLessThan(
      rows.indexOf("aborted-before-start"),
    );
    expect(rows.indexOf("aborted-before-start")).toBeLessThan(
      rows.indexOf("migrate-config"),
    );

    // Run id is no longer the row's label.
    expect(dialog).not.toHaveTextContent("wf_abc12345");

    // Duration / agents / tokens, with the terminal run's duration exact.
    expect(dialog).toHaveTextContent("8m 0s");
    expect(dialog).toHaveTextContent("7 agents");
    expect(dialog).toHaveTextContent("49.7k tokens");
    expect(screen.getAllByText(/agents/)).toHaveLength(2);

    // Status rides on the dot (accessible name), not as a third column.
    expect(screen.getAllByLabelText("running")).toHaveLength(1);
    expect(screen.getAllByLabelText("completed")).toHaveLength(1);

    // Header counts the states the user acts on.
    expect(dialog).toHaveTextContent("1 运行中");
    expect(dialog).toHaveTextContent("1 已完成");

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "stopWorkflowRun" }),
    );
  });

  it("opens a one-run dialog straight into that run's detail", () => {
    renderChatApp();
    openWorkflowsDialog([
      makeRun({
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
        logs: ["phase() Scan 开始"],
      }),
    ]);

    const dialog = screen.getByTestId("workflow-manager");
    // No click: the single run's detail is already on screen.
    expect(dialog).toHaveTextContent("Script: /runs/wf_abc12345/script.js");
    expect(dialog).toHaveTextContent("Description: 审查并修复测试与类型错误");
    expect(dialog).toHaveTextContent("Phases:");
    expect(dialog).toHaveTextContent("Scan");
    expect(dialog).toHaveTextContent("Logs:");
    expect(dialog).toHaveTextContent("phase() Scan 开始");

    // Nothing to go back to, so the back button is replaced by closing.
    expect(dialog).not.toHaveTextContent("返回列表");
    fireEvent.click(screen.getByText("关闭"));
    expect(screen.queryByTestId("workflow-manager")).toBeNull();
  });

  it("keeps the list reachable when more than one run exists", () => {
    renderChatApp();
    openWorkflowsDialog([
      makeRun(),
      makeRun({
        runId: "wf_def67890",
        meta: { name: "migrate-config", description: "迁移" },
      }),
    ]);

    const dialog = screen.getByTestId("workflow-manager");
    expect(dialog).not.toHaveTextContent("Script:");

    fireEvent.click(screen.getByText("audit-and-fix"));
    expect(dialog).toHaveTextContent("Script: /runs/wf_abc12345/script.js");

    fireEvent.click(screen.getByText("返回列表"));
    expect(dialog).toHaveTextContent("migrate-config");
    expect(dialog).not.toHaveTextContent("Script:");
  });

  it("hides the phases and logs sections before either has content", () => {
    renderChatApp();
    openWorkflowsDialog([makeRun()]);

    const dialog = screen.getByTestId("workflow-manager");
    expect(dialog).toHaveTextContent("Agents: 0");
    // An empty "Phases:" / "Logs:" block reads as missing data.
    expect(dialog).not.toHaveTextContent("Phases:");
    expect(dialog).not.toHaveTextContent("Logs:");
  });

  it("reports failures and the error of a failed run", () => {
    renderChatApp();
    openWorkflowsDialog([
      makeRun({
        status: "failed",
        endTime: BASE + 60000,
        error: "Agent #3 exceeded token budget and aborted",
        failures: ["pipeline[2] failed: 代理未返回结构化结果"],
      }),
    ]);

    const dialog = screen.getByTestId("workflow-manager");
    expect(dialog).toHaveTextContent(
      "Error: Agent #3 exceeded token budget and aborted",
    );
    expect(dialog).toHaveTextContent("Failures:");
    expect(dialog).toHaveTextContent(
      "pipeline[2] failed: 代理未返回结构化结果",
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("stops a running run by its run id", () => {
    const { vscode } = renderChatApp();
    openWorkflowsDialog([makeRun()]);

    // The row is the run, so the click must not be read as "open the detail".
    fireEvent.click(screen.getByText("停止"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "stopWorkflowRun",
      runId: "wf_abc12345",
    });
    expect(screen.getByText("停止中...")).toBeDisabled();
  });
});
