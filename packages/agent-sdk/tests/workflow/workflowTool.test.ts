import { describe, it, expect, vi } from "vitest";
import { workflowTool } from "../../src/tools/workflowTool.js";

function createMockContext(workflowManager?: Record<string, unknown>) {
  return {
    workflowManager: workflowManager || null,
  } as unknown as import("../../src/tools/types.js").ToolContext;
}

const VALID_SCRIPT = `export const meta = { name: "test-wf", description: "A test" };\nreturn 42;`;

describe("workflowTool", () => {
  it("returns error when workflow manager is not available", async () => {
    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      createMockContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  it("starts a workflow with inline script", async () => {
    const mockManager = {
      createRun: vi.fn().mockResolvedValue({
        runId: "wf_test123",
        meta: { name: "test-wf", description: "A test", phases: [] },
        scriptPath: "/tmp/test.js",
        status: "running",
      }),
      startRun: vi.fn().mockResolvedValue(undefined),
    };

    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      createMockContext(mockManager),
    );

    expect(result.success).toBe(true);
    expect(result.content as string).toContain("wf_test123");
    expect(result.content as string).toContain("test-wf");
    expect(mockManager.createRun).toHaveBeenCalledWith(
      VALID_SCRIPT,
      undefined,
      {
        resumeFromRunId: undefined,
      },
    );
    expect(mockManager.startRun).toHaveBeenCalledWith("wf_test123");
  });

  it("starts a workflow with scriptPath", async () => {
    // Create a temp script file
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-tool-test-"));
    const scriptPath = path.join(tmpDir, "workflow.js");
    await fs.writeFile(scriptPath, VALID_SCRIPT, "utf-8");

    const mockManager = {
      createRun: vi.fn().mockResolvedValue({
        runId: "wf_test456",
        meta: { name: "file-wf", description: "From file", phases: [] },
        scriptPath: path.join(tmpDir, "test2.js"),
        status: "running",
      }),
      startRun: vi.fn().mockResolvedValue(undefined),
    };

    const result = await workflowTool.execute(
      { scriptPath },
      createMockContext(mockManager),
    );

    expect(result.success).toBe(true);
    expect(mockManager.createRun).toHaveBeenCalledWith(
      VALID_SCRIPT,
      undefined,
      {
        resumeFromRunId: undefined,
      },
    );

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it("returns error when neither script nor scriptPath is provided", async () => {
    const mockManager = {
      createRun: vi.fn(),
      startRun: vi.fn(),
    };

    const result = await workflowTool.execute(
      { args: { input: "test" } },
      createMockContext(mockManager),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Either 'script' or 'scriptPath'");
    expect(mockManager.createRun).not.toHaveBeenCalled();
  });

  it("returns error when script file cannot be read", async () => {
    const mockManager = {
      createRun: vi.fn(),
      startRun: vi.fn(),
    };

    const result = await workflowTool.execute(
      { scriptPath: "/nonexistent/path.js" },
      createMockContext(mockManager),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read script file");
    expect(mockManager.createRun).not.toHaveBeenCalled();
  });

  it("returns error when createRun throws", async () => {
    const mockManager = {
      createRun: vi
        .fn()
        .mockRejectedValue(new Error("Script validation failed")),
      startRun: vi.fn(),
    };

    const result = await workflowTool.execute(
      { script: "bad script" },
      createMockContext(mockManager),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Script validation failed");
  });

  it("passes args and resumeFromRunId to createRun", async () => {
    const mockManager = {
      createRun: vi.fn().mockResolvedValue({
        runId: "wf_test789",
        meta: { name: "test-wf", description: "A test", phases: [] },
        scriptPath: "/tmp/test.js",
        status: "running",
      }),
      startRun: vi.fn().mockResolvedValue(undefined),
    };

    await workflowTool.execute(
      {
        script: VALID_SCRIPT,
        args: { key: "value" },
        resumeFromRunId: "wf_old123",
      },
      createMockContext(mockManager),
    );

    expect(mockManager.createRun).toHaveBeenCalledWith(
      VALID_SCRIPT,
      { key: "value" },
      { resumeFromRunId: "wf_old123" },
    );
  });

  it("includes phases in output when meta has phases", async () => {
    const mockManager = {
      createRun: vi.fn().mockResolvedValue({
        runId: "wf_phases",
        meta: {
          name: "phased-wf",
          description: "With phases",
          phases: [{ title: "Scan" }, { title: "Fix" }],
        },
        scriptPath: "/tmp/test.js",
        status: "running",
      }),
      startRun: vi.fn().mockResolvedValue(undefined),
    };

    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      createMockContext(mockManager),
    );

    expect(result.success).toBe(true);
    expect(result.content as string).toContain("Scan → Fix");
  });

  describe("formatCompactParams", () => {
    const ctx = createMockContext();

    it("shows scriptPath when present", () => {
      const result = workflowTool.formatCompactParams!(
        {
          scriptPath: "/tmp/workflow.js",
        },
        ctx,
      );
      expect(result).toBe("scriptPath: /tmp/workflow.js");
    });

    it("extracts name from script", () => {
      const result = workflowTool.formatCompactParams!(
        {
          script: `export const meta = { name: "my-workflow", description: "test" };\nreturn 1;`,
        },
        ctx,
      );
      expect(result).toBe("my-workflow");
    });

    it("shows truncated script when no name match", () => {
      const result = workflowTool.formatCompactParams!(
        {
          script: "some very long script without a name",
        },
        ctx,
      );
      expect(result).toContain("...");
    });

    it("returns workflow when no script or path", () => {
      const result = workflowTool.formatCompactParams!({}, ctx);
      expect(result).toBe("workflow");
    });
  });
});
