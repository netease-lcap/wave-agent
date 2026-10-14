/**
 * Which host carries the ExitPlanMode plan body.
 *
 * Every host with an editor column or a pane system routes the plan there and
 * strips it from the confirmation dialog (JB editor tab / VSCE preview panel /
 * desktop plan panel), which is why the dialog stays compact. The remote-control
 * Web page has neither: it is a phone-sized browser tab with no editor to open
 * and no pane system to put a second carrier in, so the dialog IS the carrier —
 * the plan is the only basis on which the user can approve it
 * (spec core/plan-mode.md 场景 13 / ui/remote-control.md 场景 22).
 *
 * The decision is made in one place (`ChatApp` `showConfirmation`), so these
 * tests pin the two ends of it: what the dialog ends up holding on the page, and
 * that it is unchanged everywhere else.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderChatApp, screen, sendCommand } from "./test-utils";
import { BASH_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from "wave-agent-sdk";

const PLAN = "## 重构方案\n\n- 步骤一：抽 `src/a.ts`\n- 步骤二";

function showPlanConfirmation(planContent: string) {
  act(() => {
    sendCommand("showConfirmation", {
      confirmationId: "conf_plan_1",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划待确认",
      planContent,
    });
  });
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("the plan body on the remote-control Web page", () => {
  it("renders the plan full text inside the confirmation dialog", () => {
    window.waveRemotePage = true;
    renderChatApp();

    showPlanConfirmation(PLAN);

    const preview = screen.getByTestId("plan-content-preview");
    // The whole plan, rendered as markdown — not a summary line, not a filename.
    expect(preview.querySelector("h2")).toHaveTextContent("重构方案");
    expect(preview.querySelectorAll("li")).toHaveLength(2);
    // The dialog is still the dialog: the card is what the user answers.
    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
  });

  it("keeps the dialog compact in every other host, where the plan has its own carrier", () => {
    renderChatApp();

    showPlanConfirmation(PLAN);

    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(
      document.querySelector(".plan-content-preview"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing for a plan that is empty or blank", () => {
    window.waveRemotePage = true;
    renderChatApp();

    showPlanConfirmation("");
    expect(
      screen.queryByTestId("plan-content-preview"),
    ).not.toBeInTheDocument();

    // A blank body would otherwise leave an empty titled box in the card.
    showPlanConfirmation("   \n  ");
    expect(
      screen.queryByTestId("plan-content-preview"),
    ).not.toBeInTheDocument();
  });

  it("gates on the tool, not on the presence of a plan body", () => {
    window.waveRemotePage = true;
    renderChatApp();

    // A stray planContent on another tool's confirmation has no carrier here
    // either — the tool name is the only thing that says 「this is a plan」.
    act(() => {
      sendCommand("showConfirmation", {
        confirmationId: "conf_bash_1",
        toolName: BASH_TOOL_NAME,
        confirmationType: "命令待确认",
        toolInput: { command: "rm -rf build" },
        planContent: PLAN,
      });
    });

    expect(document.querySelector(".confirmation-dialog")).toBeInTheDocument();
    expect(
      screen.queryByTestId("plan-content-preview"),
    ).not.toBeInTheDocument();
  });
});
