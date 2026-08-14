/**
 * Plan-mode reminder lifecycle integration tests.
 *
 * Covers docs/specs/core/plan-mode.md scenarios that the entry-reminder
 * tests do not: one-shot entry reminder (一次性计划进入提醒 / 场景 1-2),
 * one-time exit notification (计划模式退出通知 / 场景 1-2) and the re-entry
 * reminder (计划模式重新进入引导 / 场景 1-3).
 *
 * The Agent, permission manager, plan file path generation and reminder
 * injection run for real (plan files are really created in the temp
 * homedir); only the AI service is mocked to drive the turns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Agent } from "../../src/agent.js";
import * as aiService from "../../src/services/aiService.js";
import type { PermissionCallback } from "../../src/types/permissions.js";

vi.mock("../../src/services/aiService.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/aiService.js")>();
  return {
    ...actual,
    callAgent: vi.fn(),
  };
});

describe("Plan mode reminder lifecycle (spec core/plan-mode.md)", () => {
  let agent: Agent | undefined;
  let callAgent: ReturnType<typeof vi.fn>;
  let workdir: string;
  let planFileToClean: string | undefined;

  /** Wait until the async plan file path has been generated. */
  async function waitForPlanFilePath(timeoutMs = 2000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = agent!.getPlanFilePath();
      if (p) return p;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("plan file path was not generated in time");
  }

  /** Extract text from a message's content parts. */
  function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p: { type?: string; text?: string }) =>
          p.type === "text" ? (p.text ?? "") : "",
        )
        .join("");
    }
    return "";
  }

  /** User message texts of the n-th callAgent invocation (1-based). */
  function userTextsOfCall(n: number): string[] {
    const options = callAgent.mock.calls[n - 1]?.[0];
    if (!options) return [];
    return (options.messages as Array<{ role: string; content: unknown }>)
      .filter((m) => m.role === "user")
      .map((m) => messageText(m.content));
  }

  /** Count occurrences of a marker in the LAST callAgent invocation. */
  function lastCallOccurrences(marker: string): number {
    const lastCall = callAgent.mock.calls[callAgent.mock.calls.length - 1];
    if (!lastCall) return 0;
    const options = lastCall[0];
    return (options.messages as Array<{ role: string; content: unknown }>)
      .filter((m) => m.role === "user")
      .map((m) => messageText(m.content))
      .filter((text) => text.includes(marker)).length;
  }

  async function approveExitPlanMode(): Promise<void> {
    const taskManager = (agent as unknown as { taskManager: unknown })
      .taskManager;
    await (
      agent as unknown as {
        toolManager: { execute: (...a: unknown[]) => Promise<unknown> };
      }
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });
  }

  function createPlanFile(planFilePath: string): void {
    fs.mkdirSync(path.dirname(planFilePath), { recursive: true });
    fs.writeFileSync(planFilePath, "# My plan");
    planFileToClean = planFilePath;
  }

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-plan-remind-"));
    callAgent = vi.mocked(aiService.callAgent);
    callAgent.mockClear();
    callAgent.mockResolvedValue({
      content: "ok",
      finish_reason: "stop",
    });
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
      agent = undefined;
    }
    if (planFileToClean) {
      fs.rmSync(path.dirname(planFileToClean), {
        recursive: true,
        force: true,
      });
      planFileToClean = undefined;
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("injects the full plan reminder once and never again (plan-mode.md / 一次性计划进入提醒 / 场景 1-2)", async () => {
    agent = await Agent.create({ workdir });
    agent.setPermissionMode("plan");
    const planFilePath = await waitForPlanFilePath();
    expect(planFilePath).toBeDefined();

    await agent.sendMessage("first message");
    await agent.sendMessage("second message");

    // First turn carries the full one-shot plan reminder…
    const firstUserTexts = userTextsOfCall(1).join("\n");
    expect(firstUserTexts).toContain("Plan mode is active");
    expect(firstUserTexts).toContain("## Plan Workflow");
    // …and it is injected exactly once: the meta message stays in history,
    // but the last turn still carries exactly one copy (a re-injection every
    // turn would produce two).
    expect(lastCallOccurrences("Plan mode is active")).toBe(1);
  });

  it("attaches a one-time exit notification after plan approval (plan-mode.md / 计划模式退出通知 / 场景 1-2)", async () => {
    agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: (async () => ({
        behavior: "allow",
        newPermissionMode: "default",
      })) as PermissionCallback,
    });
    const planFilePath = await waitForPlanFilePath();
    createPlanFile(planFilePath); // ExitPlanMode reads the file.
    expect(agent.getPermissionMode()).toBe("plan");

    await approveExitPlanMode();
    expect(agent.getPermissionMode()).toBe("default");

    await agent.sendMessage("first after exit");
    await agent.sendMessage("second after exit");

    // Next turn after approval announces the mode exit once…
    expect(userTextsOfCall(1).join("\n")).toContain("Exited Plan Mode");
    // …and never again (one-shot: the last turn carries exactly one copy).
    expect(lastCallOccurrences("Exited Plan Mode")).toBe(1);
  });

  it("injects the small re-entry reminder when a plan file exists (plan-mode.md / 计划模式重新进入引导 / 场景 1, 3)", async () => {
    agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: (async () => ({
        behavior: "allow",
        newPermissionMode: "default",
      })) as PermissionCallback,
    });
    const planFilePath = await waitForPlanFilePath();
    createPlanFile(planFilePath); // planExists is true on re-entry.

    await approveExitPlanMode();
    expect(agent.getPermissionMode()).toBe("default");

    // Re-enter plan mode.
    agent.setPermissionMode("plan");
    await agent.sendMessage("back to planning");
    await agent.sendMessage("still planning");

    const firstUserTexts = userTextsOfCall(1).join("\n");
    // Small re-entry reminder, not the full 5-phase workflow.
    expect(firstUserTexts).toContain("Re-entering Plan Mode");
    expect(firstUserTexts).not.toContain("## Plan Workflow");
    // One-shot: the last turn still carries exactly one copy.
    expect(lastCallOccurrences("Re-entering Plan Mode")).toBe(1);
  });

  it("falls back to the full reminder when re-entering without a plan file (plan-mode.md / 计划模式重新进入引导 / 场景 2)", async () => {
    agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: (async () => ({
        behavior: "allow",
        newPermissionMode: "default",
      })) as PermissionCallback,
    });
    const planFilePath = await waitForPlanFilePath();
    createPlanFile(planFilePath); // Needed so ExitPlanMode approval succeeds.
    await approveExitPlanMode();
    // The plan file is gone by the time the user re-enters.
    fs.rmSync(path.dirname(planFilePath), { recursive: true, force: true });
    planFileToClean = undefined;

    agent.setPermissionMode("plan");
    await agent.sendMessage("planning again");

    const firstUserTexts = userTextsOfCall(1).join("\n");
    expect(firstUserTexts).not.toContain("Re-entering Plan Mode");
    expect(firstUserTexts).toContain("Plan mode is active");
    expect(firstUserTexts).toContain("## Plan Workflow");
  });
});
