import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { Agent } from "@/agent.js";
import { ModManager } from "@/managers/modManager.js";

/**
 * 影子事件里由 **Agent 自己**发的那几条（spec ecosystem/plugin-mods.md「影子事
 * 件」）：会话开局/收尾、换模型、会动的目录变了、开局常驻的指令文件。
 *
 * 公共四字段由 `ModManager.notifyMods` 补，那张约定在 modManager.test.ts 里钉；
 * 这里只看「哪个时刻发了哪条、载荷里那几个专属字段对不对」。
 */

vi.mock("@/services/aiService");
vi.mock("fs/promises");
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return { ...actual, homedir: () => "/home/testuser" };
});

const WORKDIR = path.resolve("/tmp/test-workdir");

type NotifyModsSpy = MockInstance<ModManager["notifyMods"]>;

function classicCalls(spy: NotifyModsSpy, event: string): unknown[] {
  return spy.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => call[1]);
}

describe("Agent 派发的影子事件", () => {
  let notifyMods: NotifyModsSpy;
  let agent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // 项目记忆那份读到了内容、其余（用户记忆等）都读不到：`InstructionsLoaded`
    // 只该报真读到的那几份，不存在的不能被冒充。
    vi.mocked(fs.readFile).mockImplementation((async (
      file: fs.FileHandle | string,
    ) => {
      const target = String(file);
      if (target === path.join(WORKDIR, "AGENTS.md")) return "# 项目约定";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }) as unknown as typeof fs.readFile);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    notifyMods = vi.spyOn(ModManager.prototype, "notifyMods");
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
      agent = undefined;
    }
    notifyMods.mockRestore();
    vi.restoreAllMocks();
  });

  it("开局发 classic.SessionStart(startup)，再按文件发 InstructionsLoaded(session_start)", async () => {
    agent = await Agent.create({ workdir: WORKDIR });

    expect(classicCalls(notifyMods, "classic.SessionStart")).toEqual([
      { source: "startup" },
    ]);
    expect(classicCalls(notifyMods, "classic.InstructionsLoaded")).toEqual([
      {
        file_path: path.join(WORKDIR, "AGENTS.md"),
        memory_type: "Project",
        load_reason: "session_start",
      },
    ]);
    // 自有事件先发、镜像后发（spec「影子事件」的顺序纪律）。
    const order = notifyMods.mock.calls.map((call) => String(call[0]));
    expect(order.indexOf("classic.SessionStart")).toBeGreaterThan(-1);
  });

  it("销毁前发 classic.SessionEnd(reason: exit)", async () => {
    agent = await Agent.create({ workdir: WORKDIR });
    await agent.destroy();
    agent = undefined;

    expect(classicCalls(notifyMods, "classic.SessionEnd")).toEqual([
      { reason: "exit" },
    ]);
  });

  it("setModel 发 classic.PostModelSwitch，缓存 TTL 恒为 null", async () => {
    agent = await Agent.create({ workdir: WORKDIR });

    await agent.setModel("wave-pro");

    expect(classicCalls(notifyMods, "classic.PostModelSwitch")).toEqual([
      {
        from_model: expect.any(String),
        to_model: "wave-pro",
        context_tokens: expect.any(Number),
        cache_ttl: null,
      },
    ]);
  });

  it("会动的目录变了发 classic.CwdChanged，带上旧值；同值不重复发", async () => {
    agent = await Agent.create({ workdir: WORKDIR });
    const next = path.resolve("/tmp/other-workdir");

    agent.setCurrentWorkdir(next);
    agent.setCurrentWorkdir(next);

    expect(classicCalls(notifyMods, "classic.CwdChanged")).toEqual([
      { old_cwd: WORKDIR, new_cwd: next },
    ]);
  });
});
