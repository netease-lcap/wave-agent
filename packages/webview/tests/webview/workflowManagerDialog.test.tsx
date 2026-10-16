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

  it("marks an oversized run in its row and spells out the scale in the detail", () => {
    renderChatApp();
    // 26 agents / 6.3M tokens — past both thresholds. The host derives
    // `sizeWarning` when it hands the snapshot over, so the webview only renders.
    openWorkflowsDialog([
      makeRun({
        runId: "wf_big24680",
        meta: { name: "deep-research", description: "深调研" },
        totalAgents: 26,
        totalTokens: 6_300_000,
        sizeWarning: true,
      }),
      makeRun({
        runId: "wf_small13579",
        meta: { name: "migrate-config", description: "迁移" },
        totalAgents: 3,
        totalTokens: 31000,
      }),
    ]);

    // The row carries the marker so the size is visible while picking a run.
    expect(screen.getAllByTestId("workflow-oversized-marker")).toHaveLength(1);
    // Millions, not "6300.0k": the marker names the 1.5M threshold next to it.
    expect(screen.getByTestId("workflow-manager")).toHaveTextContent(
      "6.3M tokens",
    );
    // Detail is not on screen yet, so nothing there to assert by accident.
    expect(screen.queryByTestId("workflow-oversized")).toBeNull();

    fireEvent.click(screen.getByText("deep-research"));
    const marker = screen.getByTestId("workflow-oversized");
    expect(marker).toHaveTextContent("运行过大：26 agents / 6.3M tokens");
    expect(marker).toHaveTextContent("越过阈值 25 agents / 1.5M tokens");
    // The model is never told, so the line has to say what to do about it — via
    // this dialog's own stop button, not by pointing at another panel.
    expect(marker).toHaveTextContent("运行中，可点「停止」按钮中止");
  });

  it("drops the stop hint for an oversized run that already ended", () => {
    renderChatApp();
    openWorkflowsDialog([
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

  it("leaves a run at the threshold unmarked", () => {
    renderChatApp();
    // Exactly the thresholds (25 agents / 1.5M tokens) — "over", not "at".
    openWorkflowsDialog([
      makeRun({
        runId: "wf_at12345",
        meta: { name: "review-all", description: "全量审查" },
        totalAgents: 25,
        totalTokens: 1_500_000,
      }),
      makeRun({
        runId: "wf_def67890",
        meta: { name: "migrate-config", description: "迁移" },
      }),
    ]);

    expect(screen.queryByTestId("workflow-oversized-marker")).toBeNull();

    fireEvent.click(screen.getByText("review-all"));
    expect(screen.getByTestId("workflow-manager")).toHaveTextContent(
      "Description: 全量审查",
    );
    expect(screen.queryByTestId("workflow-oversized")).toBeNull();
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
