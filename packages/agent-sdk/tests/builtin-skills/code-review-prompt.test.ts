import { describe, it, expect } from "vitest";
import {
  buildCodeReviewPrompt,
  code_reviewSkill,
} from "../../src/builtin/skills/code-review.js";
import {
  AGENT_TOOL_NAME,
  REPORT_FINDINGS_TOOL_NAME,
} from "../../src/constants/tools.js";
import { FINDING_VERDICTS } from "../../src/tools/resultData/reportFindings.js";

// 技能正文是**静态**的，而有些指示只能由运行时事实决定：这次会话有没有 Agent
// 工具、用户有没有敲 --fix。CC 2.1.332 的 `di(cell, agentToolAvailable, …)` 整段
// 换正文，`wi()` 追加 --fix 段；我方正文同时要给用户看，所以走「基线 + 覆盖段」。
const WITH_AGENT = {
  toolNames: [AGENT_TOOL_NAME, "Read"],
  availableSkills: [],
  gitRemoteUrl: null,
};
const NO_AGENT = {
  toolNames: ["Read", "Grep"],
  availableSkills: [],
  gitRemoteUrl: null,
};
const WITH_FINDINGS = {
  toolNames: [AGENT_TOOL_NAME, REPORT_FINDINGS_TOOL_NAME, "Read"],
  availableSkills: [],
  gitRemoteUrl: null,
};

describe("buildCodeReviewPrompt", () => {
  it("adds nothing when the session looks normal", () => {
    expect(buildCodeReviewPrompt("", WITH_AGENT)).toBe("");
  });

  it("adds the fix section only when --fix was passed", () => {
    const text = buildCodeReviewPrompt("--fix", WITH_AGENT);
    expect(text).toContain("Applying fixes (--fix)");
    expect(text).toContain("apply the");
    expect(buildCodeReviewPrompt("high", WITH_AGENT)).not.toContain(
      "Applying fixes",
    );
  });

  it("overrides the fan-out phases when the Agent tool is unavailable", () => {
    const text = buildCodeReviewPrompt("", NO_AGENT);
    expect(text).toContain(AGENT_TOOL_NAME);
    expect(text).toContain("not available");
    // 必须点明它覆盖的是哪一节，否则模型不知道该听哪一句
    expect(text).toContain("Phase 3");
    expect(text).toContain("Phase 4");
  });

  it("keeps both sections and separates them", () => {
    const text = buildCodeReviewPrompt("--fix", NO_AGENT);
    expect(text).toContain("Phase 3");
    expect(text).toContain("Applying fixes (--fix)");
    expect(text).toContain("\n\n## ");
  });

  it("does not offer the override when the Agent tool is there", () => {
    expect(buildCodeReviewPrompt("high", WITH_AGENT)).not.toContain(
      "not available",
    );
  });

  // 清单工具在不在，决定「结果往哪写」：有工具就整份走 data、正文不再复述；
  // 没有就落回正文里那段人类可读格式（CC 的 `wo()` 与 `yo` 两套契约）。
  it("asks for the tool call only when the findings tool is there", () => {
    const withTool = buildCodeReviewPrompt("", WITH_FINDINGS);
    expect(withTool).toContain(
      `Call the ${REPORT_FINDINGS_TOOL_NAME} tool once`,
    );
    expect(withTool).toContain("Do not also print the findings as text");
    expect(withTool).toContain("If findings are fixed later");

    const withoutTool = buildCodeReviewPrompt("", WITH_AGENT);
    expect(withoutTool).not.toContain(REPORT_FINDINGS_TOOL_NAME);
    expect(withoutTool).not.toContain("If findings are fixed later");
  });

  // CC 的 `wi()` 在 --fix 上分两支：能重报就要求带 outcome（界面靠它更新每条状态），
  // 不能就只要一段文字小结。
  it("asks for an outcome per finding after --fix, only with the tool", () => {
    const withTool = buildCodeReviewPrompt("--fix", WITH_FINDINGS);
    expect(withTool).toContain("no_change_needed");
    expect(withTool).toContain("skipped");
    expect(withTool).toContain("one line per skipped finding");

    const withoutTool = buildCodeReviewPrompt("--fix", WITH_AGENT);
    expect(withoutTool).toContain(
      "Finish with a brief summary of what was fixed",
    );
    expect(withoutTool).not.toContain("no_change_needed");
  });

  it("puts the output contract after the fix section", () => {
    const text = buildCodeReviewPrompt("--fix", WITH_FINDINGS);
    expect(text.indexOf("Applying fixes (--fix)")).toBeLessThan(
      text.indexOf("## Output"),
    );
  });

  // 打分制换成 CC 2.1.332 的三态核实：阈值不再存在，保留与否只看核实结论。
  it("verifies each candidate in three states instead of scoring it", () => {
    const body = code_reviewSkill["skills/code-review/SKILL.md"] ?? "";
    for (const verdict of FINDING_VERDICTS) expect(body).toContain(verdict);
    expect(body).toContain(
      "Keep candidates where the vote is CONFIRMED or PLAUSIBLE",
    );
    expect(body).not.toContain("confidence score");
    expect(body).not.toContain("threshold");
  });
});
