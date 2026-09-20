import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmationDetails } from "../../src/components/ConfirmationDetails.js";
import { stripAnsiColors } from "wave-agent-sdk";
import chalk from "chalk";

// The plan is a Markdown file (the agent writes it to ~/.wave/plans/<name>.md),
// so the confirmation details area renders it with the shared Markdown renderer
// and then linearizes the rendered rows for PgUp/PgDn scrolling (spec:
// docs/specs/ui/confirm-ui.md「确认详情超高时滚动」场景 9).
describe("ConfirmationDetails plan rendering", () => {
  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    chalk.level = 1;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the plan as Markdown instead of raw syntax", async () => {
    const plan =
      "## 实现步骤\n\n- 先读代码\n- 再改代码\n\n**注意**：不要改测试";
    const { lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={plan}
        maxHeight={20}
      />,
    );

    await vi.waitFor(() => {
      const frame = lastFrame() || "";
      const plain = stripAnsiColors(frame);
      // Lists become bullets, emphasis is styled away, not printed literally.
      expect(plain).toContain("• 先读代码");
      expect(plain).toContain("• 再改代码");
      expect(plain).not.toContain("- 先读代码");
      expect(plain).not.toContain("**注意**");
      expect(plain).toContain("注意");
      // Headings keep the renderer's colored `#` prefix (same as messages).
      expect(frame).toContain(chalk.cyan("## 实现步骤"));
    });
  });

  it("renders a Markdown table as a table, not pipes", async () => {
    const plan = "| 步骤 | 说明 |\n| --- | --- |\n| 1 | 改代码 |";
    const { lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={plan}
        maxHeight={20}
      />,
    );

    await vi.waitFor(() => {
      const plain = stripAnsiColors(lastFrame() || "");
      expect(plain).toContain("│ 步骤 │");
      expect(plain).toContain("│ 1    │ 改代码 │");
      expect(plain).toContain("└──────┴────────┘");
      expect(plain).not.toContain("| --- | --- |");
    });
  });

  it("scrolls over the rendered Markdown rows (indicators count them)", async () => {
    // 30 list items render to exactly 30 bullets.
    const plan = Array.from({ length: 30 }, (_, i) => `- 项 ${i}`).join("\n");
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={plan}
        maxHeight={10}
      />,
    );

    await vi.waitFor(() => {
      const plain = stripAnsiColors(lastFrame() || "");
      expect(plain).toContain("• 项 0");
      expect(plain).not.toContain("• 项 5"); // outside the 5-row viewport
      expect(plain).toContain("↓ 25 more");
    });

    stdin.write("\u001B[6~"); // PgDn
    await vi.waitFor(() => {
      const plain = stripAnsiColors(lastFrame() || "");
      expect(plain).toContain("• 项 5");
      expect(plain).toContain("↑ 5 more");
    });
  });
});
