import { describe, it, expect, vi } from "vitest";
import { workflowTool } from "../../src/tools/workflowTool.js";
import { BUILTIN_CONTENT } from "../../src/builtin/index.js";
import type { ToolPromptArgs } from "../../src/tools/types.js";
import type { SkillMetadata } from "../../src/types/skills.js";

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

    it("shows the script basename when only scriptPath is given", () => {
      const result = workflowTool.formatCompactParams!(
        {
          scriptPath: "/tmp/workflow.js",
        },
        ctx,
      );
      expect(result).toBe("workflow.js");
    });

    it("shows meta.description rather than meta.name", () => {
      const result = workflowTool.formatCompactParams!(
        {
          script: `export const meta = { name: "my-workflow", description: "Find flaky tests and propose fixes" };\nreturn 1;`,
        },
        ctx,
      );
      expect(result).toBe("Find flaky tests and propose fixes");
    });

    it("strips control characters from the description", () => {
      const result = workflowTool.formatCompactParams!(
        {
          script: `export const meta = { name: "x", description: "Keep\u2028it\u0007clean" };\nreturn 1;`,
        },
        ctx,
      );
      expect(result).toBe("Keepitclean");
    });

    it("falls back to the first non-empty line when meta cannot be parsed", () => {
      const result = workflowTool.formatCompactParams!(
        {
          script: "some very long script without a name",
        },
        ctx,
      );
      expect(result).toBe("some very long script without a name");
    });

    it("truncates an over-long fallback line", () => {
      const result = workflowTool.formatCompactParams!(
        { script: "x".repeat(120) },
        ctx,
      );
      expect(result).toBe(`${"x".repeat(79)}…`);
    });

    it("appends a line hint when the fallback script has more lines", () => {
      const result = workflowTool.formatCompactParams!(
        { script: "// scan logs\nconst x = 1;" },
        ctx,
      );
      expect(result).toBe("// scan logs … +1 line");
    });

    it("returns an empty string when there is no script or path", () => {
      expect(workflowTool.formatCompactParams!({}, ctx)).toBe("");
      expect(workflowTool.formatCompactParams!({ script: "  \n " }, ctx)).toBe(
        "",
      );
    });
  });

  describe("tool description — API reference progressive disclosure", () => {
    const AUTHORING_SKILL = "workflow-authoring";

    function skillMetadata(
      name: string,
      overrides: Partial<SkillMetadata> = {},
    ): SkillMetadata {
      return {
        name,
        description: `${name} skill`,
        type: "builtin",
        skillPath: `/builtin/skills/${name}`,
        ...overrides,
      };
    }

    function renderLean(args?: ToolPromptArgs): string {
      const lean = workflowTool.leanPrompt;
      if (typeof lean !== "function") {
        throw new Error("workflowTool.leanPrompt must be a function");
      }
      return lean(args);
    }

    const tiers: Array<{
      name: string;
      render: (args?: ToolPromptArgs) => string;
    }> = [
      { name: "prompt", render: (args) => workflowTool.prompt!(args) },
      { name: "leanPrompt", render: renderLean },
    ];

    // Shape/signature essentials the model needs whatever happens to the reference:
    // meta's required fields and phases element shape, pipeline's callback
    // arguments, parallel's barrier semantics, agent()'s return convention.
    const SHAPE_POINTS = [
      "export const meta = {...}",
      "{ title, detail? }",
      "agent(prompt, opts?)",
      "(prevResult, originalItem, index)",
      "BARRIER",
      "the subagent's final text",
      "hard cap",
    ];

    // Lines that exist only in the full reference (the part moved into the skill).
    const REFERENCE_ONLY = [
      "# Workflow authoring reference",
      "Adversarial verify",
      "Loop-until-dry",
      "No silent caps",
      "## Resume",
      "Choosing a shape",
    ];

    for (const { name, render } of tiers) {
      it(`${name}: sends the shape essentials plus a pointer when the skill is loadable`, () => {
        const description = render({
          availableSkills: [skillMetadata(AUTHORING_SKILL)],
        });

        for (const point of SHAPE_POINTS) {
          expect(description).toContain(point);
        }
        expect(description).toContain(`load the \`${AUTHORING_SKILL}\` skill`);
        for (const line of REFERENCE_ONLY) {
          expect(description).not.toContain(line);
        }
      });

      it(`${name}: inlines the full reference when the skill is not loadable`, () => {
        const description = render({
          availableSkills: [skillMetadata("deep-research")],
        });

        for (const point of SHAPE_POINTS) {
          expect(description).toContain(point);
        }
        for (const line of REFERENCE_ONLY) {
          expect(description).toContain(line);
        }
        expect(description).not.toContain(
          `load the \`${AUTHORING_SKILL}\` skill`,
        );
      });
    }

    it("treats a model-invocation-disabled authoring skill as not loadable", () => {
      const description = workflowTool.prompt!({
        availableSkills: [
          skillMetadata(AUTHORING_SKILL, { disableModelInvocation: true }),
        ],
      });

      expect(description).toContain("# Workflow authoring reference");
    });

    it("inlines the reference when no skills are passed at all", () => {
      expect(workflowTool.prompt!()).toContain(
        "# Workflow authoring reference",
      );
      expect(renderLean()).toContain("# Workflow authoring reference");
    });

    it("keeps the skill body and the inline fallback identical", () => {
      const skillFile = BUILTIN_CONTENT["skills/workflow-authoring/SKILL.md"];
      expect(skillFile).toContain("name: workflow-authoring");

      const frontmatterEnd = skillFile.indexOf("\n---\n", "---".length);
      const body = skillFile.slice(frontmatterEnd + "\n---\n".length).trim();

      expect(body.length).toBeGreaterThan(0);
      expect(workflowTool.prompt!()).toContain(body);
    });
  });
});
