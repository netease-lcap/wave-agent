import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { PlanDisplay } from "../../src/components/PlanDisplay.js";

import { Box, Text } from "ink";

// Mock Markdown component
vi.mock("../../src/components/Markdown.js", () => ({
  Markdown: ({ children }: { children: string }) => (
    <Box>
      <Text>{children}</Text>
    </Box>
  ),
}));

describe("PlanDisplay", () => {
  it("should render plan content correctly", () => {
    const plan = "1. Step one\n2. Step two";
    const { lastFrame } = render(<PlanDisplay plan={plan} />);
    expect(lastFrame()).toContain("1. Step one");
    expect(lastFrame()).toContain("2. Step two");
  });

  it("should truncate long plans when not expanded", () => {
    const longPlan = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`).join(
      "\n",
    );
    const { lastFrame } = render(
      <PlanDisplay plan={longPlan} isExpanded={false} />,
    );
    expect(lastFrame()).toContain("plan truncated");
    expect(lastFrame()).toContain("30 lines total");
  });

  it("should not truncate when expanded", () => {
    const longPlan = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`).join(
      "\n",
    );
    const { lastFrame } = render(
      <PlanDisplay plan={longPlan} isExpanded={true} />,
    );
    expect(lastFrame()).not.toContain("plan truncated");
    expect(lastFrame()).toContain("Step 30");
  });
});
