import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { cleanupMetaOnlySessions } from "../../src/services/session.js";
import {
  MOD_LIMITS,
  type ModCopyRequest,
  type ModPromptReadRequest,
} from "../../src/types/mods.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("../../src/managers/aiManager.js");
vi.mock("../../src/managers/mcpManager.js");
vi.mock("../../src/managers/skillManager.js");
vi.mock("../../src/services/session.js");

const workdir = "/test/workdir";

/** `$.prompt.read` 的入口：mod 那边的调用经 ModManager 落到这里。 */
function drafter(agent: Agent) {
  return (
    agent as unknown as {
      modManager: {
        promptDraftReader?: () => Promise<{ text: string; cursor: number }>;
      };
    }
  ).modManager.promptDraftReader;
}

/** `$.ui.copy` 的入口，同一条通道。 */
function copier(agent: Agent) {
  return (
    agent as unknown as {
      modManager: {
        copySink?: (request: {
          text: string;
          surface?: "terminal" | "desktop" | "vscode" | "mobile";
        }) => Promise<unknown>;
      };
    }
  ).modManager.copySink;
}

describe("Agent 的 $.prompt.read / $.ui.copy 往返", () => {
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cleanupMetaOnlySessions).mockResolvedValue(0);
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(SkillManager.prototype.getAvailableSkills).mockReturnValue([]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("草稿请求交给宿主，回执到达后 resolve 内容与光标", async () => {
    const requests: ModPromptReadRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModPromptRead: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const pending = drafter(agent)!();
    expect(requests).toHaveLength(1);
    expect(requests[0].requestId).toBeTypeOf("string");

    agent.resolveModPromptRead(requests[0].requestId, "半句话", 3);
    await expect(pending).resolves.toEqual({ text: "半句话", cursor: 3 });
  });

  it("宿主没接这条通道时立刻答空草稿，不发请求", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    await expect(drafter(agent)!()).resolves.toEqual({ text: "", cursor: 0 });
  });

  it("超时按空草稿作答，晚到的回执不再改变结果", async () => {
    vi.useFakeTimers();
    const requests: ModPromptReadRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModPromptRead: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const pending = drafter(agent)!();
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.promptReadTimeoutMs);
    await expect(pending).resolves.toEqual({ text: "", cursor: 0 });

    agent.resolveModPromptRead(requests[0].requestId, "迟到的草稿", 5);
    await expect(pending).resolves.toEqual({ text: "", cursor: 0 });
  });

  it("剪贴板请求交给宿主，回执到达后 resolve 成没成", async () => {
    const requests: ModCopyRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModCopy: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const pending = copier(agent)!({ text: "一段话", surface: "desktop" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ text: "一段话", surface: "desktop" });

    agent.resolveModCopy(requests[0].requestId, true);
    await expect(pending).resolves.toEqual({ isCopied: true });
  });

  it("宿主答「没有剪贴板」时按 reason 原样透传，其余拒绝一律归一成 refused", async () => {
    const requests: ModCopyRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModCopy: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const noClipboard = copier(agent)!({ text: "x" });
    agent.resolveModCopy(requests[0].requestId, false, "no-clipboard");
    await expect(noClipboard).resolves.toEqual({
      isCopied: false,
      reason: "no-clipboard",
    });

    const other = copier(agent)!({ text: "x" });
    agent.resolveModCopy(requests[1].requestId, false, "user-said-no");
    await expect(other).resolves.toEqual({
      isCopied: false,
      reason: "refused",
    });
  });

  it("宿主没接剪贴板时立刻答 no-surface，回调自己抛错时也一样", async () => {
    const unwired = await Agent.create({ workdir });
    activeAgent = unwired;
    await expect(copier(unwired)!({ text: "x" })).resolves.toEqual({
      isCopied: false,
      reason: "no-surface",
    });
    await unwired.destroy();
    activeAgent = undefined;

    const throwing = await Agent.create({
      workdir,
      callbacks: {
        onModCopy: () => {
          throw new Error("host blew up");
        },
      },
    });
    activeAgent = throwing;
    await expect(copier(throwing)!({ text: "x" })).resolves.toEqual({
      isCopied: false,
      reason: "no-surface",
    });
  });

  it("超时按 no-surface 收口，不让 mod 的 await 挂住", async () => {
    vi.useFakeTimers();
    const agent = await Agent.create({
      workdir,
      callbacks: { onModCopy: () => {} },
    });
    activeAgent = agent;

    const pending = copier(agent)!({ text: "x" });
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.promptReadTimeoutMs);
    await expect(pending).resolves.toEqual({
      isCopied: false,
      reason: "no-surface",
    });
  });
});
