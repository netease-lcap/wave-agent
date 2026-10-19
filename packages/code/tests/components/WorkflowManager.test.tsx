import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { WorkflowManager } from "../../src/components/WorkflowManager.js";
import type { WorkflowRun } from "wave-agent-sdk";

// Mock useChat with mutable state
let mockWorkflowRuns: WorkflowRun[] = [];
const mockStopWorkflowRun = vi.fn();
const mockSaveWorkflowScript = vi.fn();

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    get workflowRuns() {
      return mockWorkflowRuns;
    },
    stopWorkflowRun: mockStopWorkflowRun,
    saveWorkflowScript: mockSaveWorkflowScript,
  }),
}));

// Handed over oldest-first on purpose: the list itself has to put the newest run
// on top (spec multi-agent/workflow「工作流管理对话框」场景 1).
const mockRuns: WorkflowRun[] = [
  {
    runId: "run-1",
    meta: { name: "audit-wf", description: "Audit the codebase" },
    status: "running",
    scriptPath: "/test.wf.ts",
    startTime: 1000,
    phases: [],
    totalAgents: 2,
    totalTokens: 500,
  },
  {
    runId: "run-2",
    meta: { name: "done-wf", description: "Completed workflow" },
    status: "completed",
    scriptPath: "/done.wf.ts",
    startTime: 2000,
    endTime: 3000,
    phases: [
      {
        title: "Phase 1",
        agentCount: 1,
        tokens: 100,
        elapsed: 500,
        startTime: 2100,
      },
    ],
    totalAgents: 1,
    totalTokens: 100,
  },
  {
    runId: "run-3",
    meta: { name: "failed-wf", description: "Failed workflow" },
    status: "failed",
    scriptPath: "/fail.wf.ts",
    startTime: 4000,
    endTime: 5000,
    phases: [],
    totalAgents: 1,
    totalTokens: 50,
    error: "Something went wrong",
    failures: ["agent 2 failed: boom"],
    logs: ["line a", "line b"],
  },
];

describe("WorkflowManager", () => {
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowRuns = [];
  });

  it("should render empty state when no runs", () => {
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    expect(lastFrame()).toContain("No workflow runs found");
  });

  it("should render named rows with status, newest first", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("audit-wf");
    expect(frame).toContain("done-wf");
    // Newest (startTime 4000) on top, oldest last.
    expect(frame.indexOf("failed-wf")).toBeLessThan(frame.indexOf("done-wf"));
    expect(frame.indexOf("done-wf")).toBeLessThan(frame.indexOf("audit-wf"));
    // The row is the workflow's name, not its run id.
    expect(frame).not.toContain("run-1");
    expect(frame).not.toContain("run-3");
    expect(frame).toContain("(running)");
    expect(frame).toContain("(completed)");
    expect(frame).toContain("(failed)");
  });

  it("should show per-row meta and a status subtitle", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("1 running · 1 completed");
    });
    const frame = lastFrame() ?? "";
    // Completed run: 3000-2000 = 1s, 1 agent, 100 tokens.
    expect(frame).toContain("1s · 1 agents · 100 tokens");
    // Failed run: 5000-4000 = 1s, 1 agent, 50 tokens.
    expect(frame).toContain("1s · 1 agents · 50 tokens");
  });

  it("should drop zero-valued counters from a row", async () => {
    mockWorkflowRuns = [
      {
        runId: "run-zero",
        meta: { name: "fresh-wf", description: "" },
        status: "running",
        scriptPath: "/fresh.wf.ts",
        startTime: 1000,
        phases: [],
        totalAgents: 0,
        totalTokens: 0,
      },
    ];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("fresh-wf");
    });
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("0 agents");
    expect(frame).not.toContain("0 tokens");
  });

  it("should mark an oversized run in the row and explain it in the detail", async () => {
    // 26 agents / 6.3M tokens — over both thresholds. The row carries the compact
    // marker; the detail spells out the scale and the thresholds, and names this
    // panel's own stop key (spec「预算与规模硬上限」场景 7: the marker is the
    // human's cue, the model is never told).
    mockWorkflowRuns = [
      {
        ...mockRuns[0],
        sizeWarning: true,
        totalAgents: 26,
        totalTokens: 6_300_000,
      },
    ];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("audit-wf");
    });
    expect(lastFrame()).toContain("⚠ Large");
    // Millions, not "6300.0k": the marker names the 1.5M threshold right below it.
    expect(lastFrame()).toContain("6.3M tokens");

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    // The detail copy is one sentence, and a narrow terminal wraps it — collapse
    // whitespace so the assertion tests the wording, not the wrap point.
    const frame = (lastFrame() ?? "").replace(/\s+/g, " ");
    expect(frame).toContain("⚠ Large run: 26 agents / 6.3M tokens");
    expect(frame).toContain("25 agents / 1.5M tokens threshold");
    expect(frame).toContain("Press k to stop it");
  });

  it("should report an oversized finished run without a stop hint", async () => {
    // A completed run is past the thresholds too, but there is nothing left to
    // stop — so the marker names no key.
    mockWorkflowRuns = [
      {
        ...mockRuns[1],
        status: "completed",
        sizeWarning: true,
        totalAgents: 26,
        totalTokens: 6_300_000,
      },
    ];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("done-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    const frame = (lastFrame() ?? "").replace(/\s+/g, " ");
    expect(frame).toContain("⚠ Large run: 26 agents / 6.3M tokens");
    expect(frame).not.toContain("Press k to stop it");
  });

  it("should not mark a run under the size thresholds", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    expect(lastFrame()).not.toContain("⚠ Large");
  });

  it("should show the selected run's script path", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    expect(lastFrame()).toContain("/fail.wf.ts");
    expect(lastFrame()).not.toContain("/done.wf.ts");
  });

  it("should call onCancel on Escape in list mode", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    stdin.write("\x1b");
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should open the detail view on Enter", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Run ID: run-3");
    expect(frame).toContain("failed-wf");
    expect(frame).toContain("Script: /fail.wf.ts");
  });

  it("should show failures, error and logs in detail view", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Error: Something went wrong");
    expect(frame).toContain("Failures:");
    expect(frame).toContain("agent 2 failed: boom");
    expect(frame).toContain("Logs (last 10 lines):");
    expect(frame).toContain("line a");
    expect(frame).toContain("line b");
  });

  it("should not render empty phases or logs sections", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    // run-3 has no phases — move to it being selected is already the default.
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    expect(lastFrame()).not.toContain("Phases:");
  });

  it("should show phases with agent, token and elapsed for a run that has them", async () => {
    mockWorkflowRuns = [mockRuns[1]];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("done-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Phases:");
    expect(frame).toContain("Phase 1 — 1 agents | 100 tokens | 500ms");
    // This run has no failures and no script log lines.
    expect(frame).not.toContain("Failures:");
    expect(frame).not.toContain("Logs");
  });

  it("should return to list view on Escape from detail mode", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("failed-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    stdin.write("\x1b");
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain("Workflow Details");
    });
    expect(lastFrame()).toContain("failed-wf");
  });

  it("should stop running task with 'k' in list mode", async () => {
    mockWorkflowRuns = [mockRuns[0]];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("audit-wf");
    });
    stdin.write("k");
    await vi.waitFor(() => {
      expect(mockStopWorkflowRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("should stop running task with 'k' in detail mode", async () => {
    mockWorkflowRuns = [mockRuns[0]];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("audit-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    stdin.write("k");
    await vi.waitFor(() => {
      expect(mockStopWorkflowRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("saves a run's script by name and scope from the detail view", async () => {
    mockSaveWorkflowScript.mockResolvedValue({
      name: "done-wf",
      path: "/proj/.wave/workflows/done-wf.js",
    });
    mockWorkflowRuns = [mockRuns[1]];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("done-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });

    stdin.write("s");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Save dynamic workflow");
    });
    // The name starts as the run's meta.name and the scope as project.
    expect(lastFrame()).toContain("Name: done-wf");
    expect(lastFrame()).toContain("Scope: project");

    // Tab flips the scope; the name is typed onto the existing one.
    stdin.write("\t");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Scope: user");
    });

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(mockSaveWorkflowScript).toHaveBeenCalledWith("run-2", {
        name: "done-wf",
        scope: "user",
        overwrite: false,
      });
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Saved");
    });
  });

  it("turns a name conflict into an overwrite on the next Enter", async () => {
    mockSaveWorkflowScript
      .mockRejectedValueOnce(
        new Error(
          'Dynamic workflow "done-wf" already exists at /proj/.wave/workflows/done-wf.js. Use a different name or overwrite.',
        ),
      )
      .mockResolvedValueOnce({
        name: "done-wf",
        path: "/proj/.wave/workflows/done-wf.js",
      });
    mockWorkflowRuns = [mockRuns[1]];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("done-wf");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });

    stdin.write("s");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Save dynamic workflow");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("already exists");
    });

    // Second Enter retries as an overwrite instead of failing the same way.
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(mockSaveWorkflowScript).toHaveBeenLastCalledWith("run-2", {
        name: "done-wf",
        scope: "project",
        overwrite: true,
      });
    });
  });
});
