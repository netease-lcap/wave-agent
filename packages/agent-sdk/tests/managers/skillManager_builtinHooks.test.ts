import { describe, it, expect } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import { AGENT_TOOL_NAME } from "../../src/constants/tools.js";
import type { Skill } from "../../src/types/index.js";

// 内置技能落盘成 SKILL.md 再扫回来，代码在这一步本来会丢；`BUILTIN_SKILL_HOOKS`
// 把它接回去。这几条钉的是「只对内建来源生效」——同样的名字放在项目 / 用户目录里，
// markdown 侧没有字段可写，也不该突然长出运行时上下文。
function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    name: "code-review",
    description: "Review the current diff",
    type: "builtin",
    skillPath: "/fake/skills/code-review",
    content:
      "---\nname: code-review\ndescription: Review the current diff\n---\n\n## Input\n\n$ARGUMENTS\n",
    frontmatter: {
      name: "code-review",
      description: "Review the current diff",
    },
    isValid: true,
    errors: [],
    ...overrides,
  };
}

// 空容器 = 这一轮没有任何已注册工具，也就是「Agent 工具不在」那种会话。
function render(skill: Skill, argsString = "", toolNames?: string[]): string {
  const container = new Container();
  if (toolNames) {
    container.register("ToolManager", {
      getTools: () => toolNames.map((name) => ({ name })),
    } as never);
  }
  const manager = new SkillManager(container, { workdir: "/fake/project" });
  return manager.renderSkillContent(skill, argsString);
}

describe("builtin skill code hooks", () => {
  it("appends the parsed arguments for a builtin skill that has a hook", () => {
    const content = render(makeSkill({}), "high --fix 42");
    expect(content).toContain("## Arguments");
    expect(content).toContain("level: high");
    expect(content).toContain("target: 42");
    expect(content).toContain("--fix: yes");
  });

  it("says nothing for a project skill with the same name", () => {
    const content = render(makeSkill({ type: "project" }), "high --fix 42");
    expect(content).not.toContain("## Arguments");
    // 正文本身照旧（$ARGUMENTS 替换还是原始串），只是没有解析结果
    expect(content).toContain("high --fix 42");
  });

  it("says nothing for a builtin skill that has no hook", () => {
    const content = render(makeSkill({ name: "verify" }), "high");
    expect(content).not.toContain("## Arguments");
  });

  it("switches to the single-pass section when the Agent tool is absent", () => {
    const content = render(makeSkill({}), "", ["Read", "Grep"]);
    expect(content).toContain("single pass, inline");
    expect(content).toContain(AGENT_TOOL_NAME);
  });

  it("keeps the baseline when the Agent tool is registered", () => {
    const content = render(makeSkill({}), "", [AGENT_TOOL_NAME, "Read"]);
    expect(content).not.toContain("single pass, inline");
  });

  it("puts the override sections after the parsed arguments", () => {
    const content = render(makeSkill({}), "--fix 42", ["Read"]);
    const argsAt = content.indexOf("\n\n## Arguments\n");
    expect(argsAt).toBeGreaterThan(-1);
    expect(content.indexOf("## Applying fixes (--fix)")).toBeGreaterThan(
      argsAt,
    );
    expect(content.indexOf("single pass, inline")).toBeGreaterThan(argsAt);
  });

  it("marks an implied level as the default", () => {
    const content = render(makeSkill({}), "");
    expect(content).toContain("## Arguments");
    expect(content).toContain("default");
  });
});
