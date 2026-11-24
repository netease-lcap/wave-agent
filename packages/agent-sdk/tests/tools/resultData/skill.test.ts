import { describe, it, expect, vi, beforeEach } from "vitest";
import { skillTool } from "@/tools/skillTool.js";
import {
  renderSkillForkedResultData,
  renderSkillResultData,
  type SkillResultData,
} from "@/tools/resultData/skill.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：渲染 `data` 得到的文本必须与工具当场产出的
 * `content` 逐字相等。期望值一律手写字面量，不从 `content` 抄——抄一遍只能证明
 * 两边用了同一个渲染器。
 *
 * Skill 的两支各自成段，但两支都能从 `data` 重建：
 * - forked：CC 的文本带一次性包装（`Skill "x" completed (forked execution).` +
 *   `Result:`）。
 * - inline：正文（SKILL.md 的内容）在 `data.content`。CC 的 inline 文本只有
 *   `Launching skill: <name>` 一行 —— 它的正文走 `newMessages` 另起一条 user 消息，
 *   我方 SDK 没有那条通道，正文只能由 tool_result 承载，所以这里渲全文。这是与 CC
 *   的一处偏差，写在 `resultData/skill.ts` 的文件头。
 */

const SKILL_BODY = "# Demo skill\n\nStep 1. Do the thing.";

const testContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager(new Container(), "test-session"),
} as unknown as ToolContext;

/** 只实现 Skill 工具真的会碰的那几个成员。 */
const skillManagerStub = (over: {
  metadata?: { model?: string; disableModelInvocation?: boolean };
  content?: string;
  allowedTools?: string[];
}) => ({
  getSkillMetadata: vi.fn(() => ({
    name: "stub",
    description: "stub skill",
    type: "personal" as const,
    skillPath: "/path/to/stub",
    ...over.metadata,
  })),
  executeSkill: vi.fn(async () => ({
    content: over.content ?? "",
    allowedTools: over.allowedTools,
  })),
});

const subagentManagerStub = (result: string) => ({
  findSubagent: vi.fn(async () => ({ name: "general-purpose", tools: [] })),
  createInstance: vi.fn(async () => ({
    subagentId: "subagent-123",
    messageManager: {
      getMessages: vi.fn(() => []),
      getLatestTotalTokens: vi.fn(() => 0),
    },
    usedTools: [],
  })),
  executeAgent: vi.fn(async () => result),
  cleanupInstance: vi.fn(),
});

describe("Skill data → 文本渲染器 golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forked：文本是 CC 的包装句 + 子代理答复，data 能原样重建", async () => {
    const context = {
      ...testContext,
      skillManager: {
        ...skillManagerStub({ content: SKILL_BODY }),
        getSkillMetadata: vi.fn(() => ({
          name: "fork-skill",
          description: "forked skill",
          type: "personal" as const,
          skillPath: "/path/to/fork-skill",
          context: "fork" as const,
          agent: "general-purpose",
        })),
      },
      subagentManager: subagentManagerStub("Subagent execution result"),
    } as unknown as ToolContext;

    const result = await skillTool.execute(
      { skill_name: "fork-skill" },
      context,
    );

    expect(result.content).toBe(
      'Skill "fork-skill" completed (forked execution).\n\nResult:\nSubagent execution result',
    );
    expect(result.data).toStrictEqual({
      success: true,
      commandName: "fork-skill",
      status: "forked",
      agentId: "subagent-123",
      result: "Subagent execution result",
    });
    expect(renderSkillResultData(result.data as SkillResultData)).toBe(
      result.content,
    );
  });

  it("inline：CC 的标量字段 + 技能正文都在 data，渲染器交出正文", async () => {
    const context = {
      ...testContext,
      skillManager: skillManagerStub({
        metadata: { model: "opus" },
        content: SKILL_BODY,
        allowedTools: ["Read", "Grep"],
      }),
    } as unknown as ToolContext;

    const result = await skillTool.execute(
      { skill_name: "demo-skill" },
      context,
    );

    expect(result.data).toStrictEqual({
      success: true,
      commandName: "demo-skill",
      // 技能正文（SKILL.md）：CC 的 data 里没有它（正文走 `newMessages`）。
      content: SKILL_BODY,
      allowedTools: ["Read", "Grep"],
      model: "opus",
    });
    expect(result.content).toBe(SKILL_BODY);
    // 正文就在 `data.content` 里，所以渲染器交出全文而不是 `Launching skill:` 那行。
    expect(renderSkillResultData(result.data as SkillResultData)).toBe(
      SKILL_BODY,
    );
  });

  it("inline：没声明 allowed-tools / model 时不写这两个键", async () => {
    const context = {
      ...testContext,
      skillManager: skillManagerStub({ content: SKILL_BODY, allowedTools: [] }),
    } as unknown as ToolContext;

    const result = await skillTool.execute(
      { skill_name: "plain-skill" },
      context,
    );

    expect(result.data).toStrictEqual({
      success: true,
      commandName: "plain-skill",
      content: SKILL_BODY,
    });
    expect(result.content).toBe(SKILL_BODY);
  });

  it("renderSkillForkedResultData：纯函数，逐字对齐 CC", () => {
    expect(
      renderSkillForkedResultData({
        success: true,
        commandName: "review-pr",
        status: "forked",
        agentId: "agent-7",
        result: "line one\nline two",
      }),
    ).toBe(
      'Skill "review-pr" completed (forked execution).\n\nResult:\nline one\nline two',
    );
  });
});
