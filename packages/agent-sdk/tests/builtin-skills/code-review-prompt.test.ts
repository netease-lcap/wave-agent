import { describe, it, expect } from "vitest";
import { buildCodeReviewPrompt } from "../../src/builtin/skills/code-review.js";
import { AGENT_TOOL_NAME } from "../../src/constants/tools.js";

// 技能正文是**静态**的，而有些指示只能由运行时事实决定：这次会话有没有 Agent
// 工具、用户有没有敲 --fix。CC 2.1.332 的 `di(cell, agentToolAvailable, …)` 整段
// 换正文，`wi()` 追加 --fix 段；我方正文同时要给用户看，所以走「基线 + 覆盖段」。
const WITH_AGENT = {
  toolNames: [AGENT_TOOL_NAME, "Read"],
  availableSkills: [],
};
const NO_AGENT = { toolNames: ["Read", "Grep"], availableSkills: [] };

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
});
