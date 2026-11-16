import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { cleanupMetaOnlySessions } from "../../src/services/session.js";
import { MOD_LIMITS, type ModPromptFillRequest } from "../../src/types/mods.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("../../src/managers/aiManager.js");
vi.mock("../../src/managers/mcpManager.js");
vi.mock("../../src/managers/skillManager.js");
vi.mock("../../src/services/session.js");

const workdir = "/test/workdir";

/** `$.prompt.fill` 的入口：mod 那边的调用经 ModManager 落到这里。 */
function filler(agent: Agent) {
  return (
    agent as unknown as {
      modManager: {
        promptFiller?: (request: {
          text: string;
          mode: "replace" | "append" | "insert";
        }) => Promise<boolean>;
      };
    }
  ).modManager.promptFiller;
}

describe("Agent 的 $.prompt.fill 往返", () => {
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

  it("把请求交给宿主，回执到达后 resolve true", async () => {
    const requests: ModPromptFillRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModPromptFill: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const pending = filler(agent)!({
      text: "再改一版",
      mode: "append",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ text: "再改一版", mode: "append" });
    // requestId 随请求下发：宿主原样带回来才能配对。
    expect(requests[0].requestId).toBeTypeOf("string");

    agent.resolveModPromptFill(requests[0].requestId, true);
    await expect(pending).resolves.toBe(true);
  });

  it("宿主答 false 时 resolve false（填不上是正常结果）", async () => {
    const requests: ModPromptFillRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModPromptFill: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const pending = filler(agent)!({ text: "x", mode: "replace" });
    agent.resolveModPromptFill(requests[0].requestId, false);
    await expect(pending).resolves.toBe(false);
  });

  it("宿主没接这条通道时立刻答 false，不发请求", async () => {
    // 终端 CLI 就是这一种（spec 场景 4）：不抛错，mod 自己降级。
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    await expect(filler(agent)!({ text: "x", mode: "replace" })).resolves.toBe(
      false,
    );
  });

  it("超时按 false 作答，晚到的回执不再改变结果", async () => {
    vi.useFakeTimers();
    const requests: ModPromptFillRequest[] = [];
    const agent = await Agent.create({
      workdir,
      callbacks: { onModPromptFill: (payload) => requests.push(payload) },
    });
    activeAgent = agent;

    const pending = filler(agent)!({ text: "x", mode: "replace" });
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.promptFillTimeoutMs);
    await expect(pending).resolves.toBe(false);

    // 界面在超时之后才把回执送回来：已经答过了，不能再翻案。
    agent.resolveModPromptFill(requests[0].requestId, true);
    await expect(pending).resolves.toBe(false);
  });

  it("宿主的回调自己抛错时答 false，不让 mod 的 await 挂住", async () => {
    const agent = await Agent.create({
      workdir,
      callbacks: {
        onModPromptFill: () => {
          throw new Error("host blew up");
        },
      },
    });
    activeAgent = agent;

    await expect(filler(agent)!({ text: "x", mode: "replace" })).resolves.toBe(
      false,
    );
  });
});
