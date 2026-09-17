import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { SkillManager } from "../../src/managers/skillManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { InvokedSkillRecord, Skill } from "../../src/types/index.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({})),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

/**
 * Post-compaction re-injection of invoked skills.
 *
 * Regression guard for a skill whose body contains `${WAVE_SKILL_DIR}`: the
 * re-injection used to re-read the raw SKILL.md, so the model got the literal
 * placeholder back (spec core/message-compact 场景 4).
 */
describe("AIManager - invoked skills re-injection", () => {
  let aiManager: AIManager;
  let container: Container;
  let loadSkill: ReturnType<typeof vi.fn>;
  let renderSkillContent: ReturnType<typeof vi.fn<(skill: Skill) => string>>;

  const skill = {
    name: "demo",
    description: "折叠后的完整描述",
    skillPath: "/skills/demo",
    content: "---\nname: demo\n---\n\nrun node ${WAVE_SKILL_DIR}/tool.mjs",
  } as unknown as Skill;

  const invoke = (records: InvokedSkillRecord[]): Promise<string> => {
    container.register("MessageManager", {
      getRecentFileReads: vi.fn().mockReturnValue([]),
      getInvokedSkills: vi.fn().mockReturnValue(records),
    } as unknown as MessageManager);
    return (
      aiManager as unknown as {
        buildPostCompactContext: (summary: string) => Promise<string>;
      }
    ).buildPostCompactContext("SUMMARY");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();

    loadSkill = vi.fn().mockResolvedValue(skill);
    renderSkillContent = vi
      .fn<(skill: Skill) => string>()
      .mockReturnValue(
        "Base directory for this skill: /skills/demo\n\nrun node /skills/demo/tool.mjs",
      );

    container.register("ToolManager", { list: vi.fn().mockReturnValue([]) });
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
    } as unknown as PermissionManager);
    container.register("HookManager", {});
    container.register("BackgroundTaskManager", {
      getAllTasks: vi.fn().mockReturnValue([]),
    });
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", {
      loadSkill,
      renderSkillContent,
    } as unknown as SkillManager);

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      callbacks: {},
    });
  });

  it("re-injects the content the model actually saw, not the raw SKILL.md", async () => {
    const rendered =
      "Base directory for this skill: /skills/demo\n\nrun node /skills/demo/tool.mjs";

    const context = await invoke([
      { skillName: "demo", timestamp: Date.now(), content: rendered },
    ]);

    expect(context).toContain("[Invoked Skills]");
    expect(context).toContain("run node /skills/demo/tool.mjs");
    expect(context).not.toContain("${WAVE_SKILL_DIR}");
    // 记录里有正文就不必再渲染一次
    expect(renderSkillContent).not.toHaveBeenCalled();
  });

  it("re-renders (with substitution) when the invocation recorded no content", async () => {
    // 旧会话的记录里没有 content：必须按技能文件重新渲染，同样完成替换
    const context = await invoke([
      { skillName: "demo", timestamp: Date.now() },
    ]);

    expect(renderSkillContent).toHaveBeenCalled();
    expect(context).toContain("run node /skills/demo/tool.mjs");
    expect(context).not.toContain("${WAVE_SKILL_DIR}");
  });

  it("shows the parsed description instead of raw frontmatter syntax", async () => {
    const context = await invoke([
      { skillName: "demo", timestamp: Date.now(), content: "rendered body" },
    ]);

    expect(loadSkill).toHaveBeenCalledWith("demo");
    expect(context).toContain("*折叠后的完整描述*");
    expect(context).not.toContain(">-");
  });

  it("skips the section when nothing was invoked", async () => {
    const context = await invoke([]);

    expect(context).toBe("SUMMARY");
  });
});
