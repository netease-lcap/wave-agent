import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { WorkflowManager } from "../../src/components/WorkflowManager.js";
import type { WorkflowRun, WorkflowMeta } from "wave-agent-sdk";

// Mock useChat with mutable state
let mockWorkflowRuns: WorkflowRun[] = [];
const mockStopWorkflowRun = vi.fn();

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    get workflowRuns() {
      return mockWorkflowRuns;
    },
    stopWorkflowRun: mockStopWorkflowRun,
  }),
}));

const mockMeta: WorkflowMeta = {
  name: "test-workflow",
  description: "A test workflow",
};

const mockRuns: WorkflowRun[] = [
  {
    runId: "run-1",
    meta: mockMeta,
    status: "running",
    scriptPath: "/test.wf.ts",
    startTime: 1000,
    phases: [],
    totalAgents: 2,
    totalTokens: 500,
  },
  {
    runId: "run-2",
    meta: { ...mockMeta, description: "Completed workflow" },
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
    meta: { ...mockMeta, name: "failed-wf" },
    status: "failed",
    scriptPath: "/fail.wf.ts",
    startTime: 4000,
    endTime: 5000,
    phases: [],
    totalAgents: 1,
    totalTokens: 50,
    error: "Something went wrong",
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

  it("should render list of runs", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
    });
    expect(lastFrame()).toContain("running");
  });

  it("should display completed run with end time", async () => {
    mockWorkflowRuns = [mockRuns[1]];
    const { lastFrame } = render(<WorkflowManager onCancel={onCancel} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-2");
    });
    expect(lastFrame()).toContain("completed");
  });

  it("should call onCancel on Escape in list mode", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
    });
    stdin.write("\x1b");
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should show detail view on Enter", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    expect(lastFrame()).toContain("test-workflow");
    expect(lastFrame()).toContain("run-1");
  });

  it("should show error in detail view for failed run", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
    });
    // Move down twice to select the failed run (index 2)
    stdin.write("\x1b[B");
    stdin.write("\x1b[B");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-3");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    expect(lastFrame()).toContain("Something went wrong");
  });

  it("should return to list view on Escape from detail mode", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
    });
    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Workflow Details");
    });
    stdin.write("\x1b");
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain("Workflow Details");
    });
    expect(lastFrame()).toContain("run-1");
  });

  it("should stop running task with 'k' in list mode", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
    });
    stdin.write("k");
    await vi.waitFor(() => {
      expect(mockStopWorkflowRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("should stop running task with 'k' in detail mode", async () => {
    mockWorkflowRuns = [...mockRuns];
    const { lastFrame, stdin } = render(
      <WorkflowManager onCancel={onCancel} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("run-1");
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
});
