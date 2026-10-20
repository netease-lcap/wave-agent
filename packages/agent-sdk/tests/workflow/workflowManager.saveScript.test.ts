import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { Container } from "../../src/utils/container.js";
import { WorkflowManager } from "../../src/managers/workflowManager.js";
import { WorkflowRegistry } from "../../src/workflow/workflowRegistry.js";
import type { WorkflowRun } from "../../src/workflow/types.js";

vi.mock("fs", () => {
  const promises = {
    readFile: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  };
  return {
    promises,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

const SCRIPT = `export const meta = { name: "saved", description: "Saved" };\nreturn 1;`;
const WORKDIR = "/home/user/project";

function createRun(): WorkflowRun {
  return {
    runId: "wf_1",
    meta: { name: "saved", description: "Saved" },
    status: "completed",
    scriptPath: "/runs/wf_1/script.js",
    startTime: 0,
    phases: [],
    totalAgents: 0,
    totalTokens: 0,
  };
}

describe("WorkflowManager.saveWorkflowScript", () => {
  let manager: WorkflowManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    container.register("Workdir", WORKDIR);
    container.register("WorkflowRegistry", new WorkflowRegistry(WORKDIR));
    manager = new WorkflowManager(container);
    vi.spyOn(manager, "listRuns").mockResolvedValue([createRun()]);
    vi.mocked(fs.promises.readFile).mockResolvedValue(SCRIPT);
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
  });

  it("writes the run's script into the project library with the canonical name", async () => {
    const saved = await manager.saveWorkflowScript("wf_1", {
      name: "My Script",
      scope: "project",
    });

    expect(saved).toEqual({
      name: "my-script",
      path: `${WORKDIR}/.wave/workflows/my-script.js`,
    });
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      `${WORKDIR}/.wave/workflows/my-script.js`,
      SCRIPT,
      { encoding: "utf-8", flag: "wx" },
    );
  });

  it("reports the conflict verbatim when the file already exists", async () => {
    vi.mocked(fs.promises.writeFile).mockRejectedValue(
      Object.assign(new Error("EEXIST"), { code: "EEXIST" }),
    );

    await expect(
      manager.saveWorkflowScript("wf_1", {
        name: "my-script",
        scope: "project",
      }),
    ).rejects.toThrow(
      `Dynamic workflow "my-script" already exists at ${WORKDIR}/.wave/workflows/my-script.js. Use a different name or overwrite.`,
    );
  });

  it("overwrites when explicitly asked", async () => {
    await manager.saveWorkflowScript("wf_1", {
      name: "my-script",
      scope: "project",
      overwrite: true,
    });

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      `${WORKDIR}/.wave/workflows/my-script.js`,
      SCRIPT,
      { encoding: "utf-8", flag: "w" },
    );
  });

  it("writes the user scope atomically", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const saved = await manager.saveWorkflowScript("wf_1", {
      name: "shared",
      scope: "user",
    });

    expect(saved.path).toContain("/.wave/workflows/shared.js");
    // Atomic write: temp file first, then rename.
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.promises.rename).toHaveBeenCalledTimes(1);
  });

  it("refuses to overwrite an existing user-scope script without overwrite", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await expect(
      manager.saveWorkflowScript("wf_1", { name: "shared", scope: "user" }),
    ).rejects.toThrow("already exists");
  });

  it("fails clearly when the run is not in this session", async () => {
    await expect(
      manager.saveWorkflowScript("wf_missing", {
        name: "x",
        scope: "project",
      }),
    ).rejects.toThrow("run wf_missing not found in this session");
  });
});
