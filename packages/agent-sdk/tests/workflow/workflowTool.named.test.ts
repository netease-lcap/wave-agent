import { describe, it, expect, vi } from "vitest";
import * as fsPromises from "fs/promises";
import { workflowTool } from "../../src/tools/workflowTool.js";
import type { ToolContext } from "../../src/tools/types.js";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

const SAVED_SCRIPT = `export const meta = { name: "saved", description: "A saved workflow" };\nreturn 1;`;

function createContext(workflowManager: Record<string, unknown>) {
  return { workflowManager } as unknown as ToolContext;
}

function createManager(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    createRun: vi.fn().mockResolvedValue({
      runId: "wf_named1",
      meta: { name: "saved", description: "A saved workflow", phases: [] },
      scriptPath: "/tmp/runs/wf_named1/script.js",
      status: "running",
    }),
    startRun: vi.fn().mockResolvedValue(undefined),
    getTurnTokenTarget: vi.fn().mockReturnValue(null),
    resolveNamedWorkflow: vi.fn().mockReturnValue({
      name: "code-review",
      description: "A saved workflow",
      source: "project",
      path: "/project/.wave/workflows/code-review.js",
      meta: { name: "saved", description: "A saved workflow" },
    }),
    listNamedWorkflows: vi
      .fn()
      .mockReturnValue([
        { name: "code-review", description: "", source: "project" },
      ]),
    ...overrides,
  };
}

describe("workflowTool named entry point", () => {
  it("runs a script resolved by name", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(SAVED_SCRIPT);
    const manager = createManager();

    const result = await workflowTool.execute(
      { name: "code-review" },
      createContext(manager),
    );

    expect(result.success).toBe(true);
    expect(manager.resolveNamedWorkflow).toHaveBeenCalledWith("code-review");
    expect(manager.createRun).toHaveBeenCalledWith(SAVED_SCRIPT, undefined, {
      resumeFromRunId: undefined,
    });
  });

  it("reports the missing name together with the available ones", async () => {
    const manager = createManager({
      resolveNamedWorkflow: vi.fn().mockReturnValue(undefined),
      listNamedWorkflows: vi.fn().mockReturnValue([
        { name: "code-review", description: "", source: "project" },
        { name: "my-plugin:scan", description: "", source: "plugin" },
      ]),
    });

    const result = await workflowTool.execute(
      { name: "my-plugin:scan-nope" },
      createContext(manager),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Workflow "my-plugin:scan-nope" not found');
    expect(result.error).toContain("code-review, my-plugin:scan");
  });

  it("rejects two script sources instead of silently preferring one", async () => {
    const manager = createManager();

    const result = await workflowTool.execute(
      { script: SAVED_SCRIPT, name: "code-review" },
      createContext(manager),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("exactly one");
    expect(manager.createRun).not.toHaveBeenCalled();
  });

  it("rejects three script sources too", async () => {
    const result = await workflowTool.execute(
      { script: SAVED_SCRIPT, scriptPath: "/tmp/a.js", name: "code-review" },
      createContext(createManager()),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("exactly one");
  });

  it("keeps the old error when no source is given", async () => {
    const result = await workflowTool.execute(
      {},
      createContext(createManager()),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Exactly one of");
  });

  it("shows the invocation name on the compact line", () => {
    expect(
      workflowTool.formatCompactParams?.(
        { name: "my-plugin:scan" },
        createContext(createManager()),
      ),
    ).toBe("my-plugin:scan");
  });
});
