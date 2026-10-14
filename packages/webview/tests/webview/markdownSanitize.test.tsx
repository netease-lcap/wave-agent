import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { ConfirmationDialog } from "../../src/components/ConfirmationDialog";
import { MockDataGenerator } from "../fixtures/mockData";
import { EXIT_PLAN_MODE_TOOL_NAME } from "wave-agent-sdk/constants";

// Mermaid is heavy and irrelevant here; stub it out. DOMPurify must stay REAL so
// these tests exercise the actual sanitize whitelists (`Message.tsx` for message
// markdown, `ConfirmationDialog.tsx` for the plan body).
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

function renderAssistantMessage(content: string) {
  const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  const message = MockDataGenerator.createAssistantMessage(content);
  return render(<Message message={message} vscode={vscode} />);
}

describe("markdown sanitize whitelist", () => {
  it("renders --- as an <hr> divider", () => {
    const { container } = renderAssistantMessage("before\n\n---\n\nafter");
    expect(container.querySelector(".markdown-content hr")).not.toBeNull();
  });

  it("renders a remote image with src and alt preserved", () => {
    const { container } = renderAssistantMessage(
      "look ![架构图](https://example.com/arch.png) here",
    );
    const img = container.querySelector(".markdown-content img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/arch.png");
    expect(img?.getAttribute("alt")).toBe("架构图");
  });
});

/**
 * The ExitPlanMode plan body is model-authored markdown that the confirmation
 * dialog injects with `dangerouslySetInnerHTML` (it is the plan's carrier on the
 * remote-control Web page, spec ui/remote-control.md 场景 22), so it goes through
 * its own DOMPurify allowlist. Real DOMPurify here for the same reason as above:
 * a mocked passthrough would assert nothing.
 */
function renderPlanConfirmation(planContent: string) {
  return render(
    <ConfirmationDialog
      confirmation={{
        confirmationId: "c1",
        toolName: EXIT_PLAN_MODE_TOOL_NAME,
        confirmationType: "计划待确认",
        toolInput: {},
        planContent,
      }}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
    />,
  );
}

describe("plan body sanitize whitelist", () => {
  it("drops a script tag but keeps the plan's own markdown", () => {
    const { container } = renderPlanConfirmation(
      '## 方案\n\n<script>alert("x")</script>\n\n- 步骤一\n- 步骤二',
    );

    const preview = container.querySelector(".plan-content-preview");
    expect(preview).not.toBeNull();
    expect(preview?.querySelector("script")).toBeNull();
    expect(preview?.querySelector("h2")?.textContent).toBe("方案");
    expect(preview?.querySelectorAll("li")).toHaveLength(2);
  });

  it("drops an event handler attribute", () => {
    const { container } = renderPlanConfirmation(
      '<a href="#" onclick="steal()">点我</a>',
    );

    const link = container.querySelector(".plan-content-preview a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("onclick")).toBeNull();
  });
});
