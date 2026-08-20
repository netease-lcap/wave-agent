import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderChatApp, screen, waitFor, sendCommand, act } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * Timeline vertical-line run classes (设计稿: assistant 时间线竖线跨消息贯穿).
 *
 * MessageList renders every message as a virtualized row; consecutive
 * role==='assistant' messages form a timeline run. A multi-dot run marks its
 * first row `.timeline-run--start` and its last row `.timeline-run--end`
 * (connecting line drawn); a single-dot run gets `.timeline-run--single`
 * (isolated dot, no line). User messages break the run and carry no class.
 */
describe("Timeline assistant runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getContainer() {
    return screen.getByTestId("messages-container");
  }

  // The run classes live on the .virtual-row wrapper (the inner .message only
  // carries data-message-id / data-role); the wrapper carries
  // data-measured-message-id.
  function rowById(id: string) {
    return getContainer().querySelector<HTMLElement>(
      `[data-measured-message-id="${id}"]`,
    );
  }

  it("marks consecutive assistant messages as a run and isolates the post-user one", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessage("first assistant", "a1"),
      MockDataGenerator.createAssistantMessage("second assistant", "a2"),
      MockDataGenerator.createUserMessage("a user question", "u1"),
      MockDataGenerator.createAssistantMessage("third assistant", "a3"),
    ];
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(getContainer().querySelector(".virtual-row")).not.toBeNull(),
    );

    // Two assistant runs → the first run spans a1..a2 (start + end), the lone
    // post-user assistant a3 is a single-dot run.
    const a1 = rowById("a1");
    const a2 = rowById("a2");
    const a3 = rowById("a3");
    expect(a1?.classList.contains("timeline-run--start")).toBe(true);
    expect(a2?.classList.contains("timeline-run--end")).toBe(true);
    expect(a3?.classList.contains("timeline-run--single")).toBe(true);

    // Multi-dot run rows are flush (paddingBottom 0) so the line segments
    // abut; the single row keeps the inter-message spacing (10px).
    expect(a1?.style.paddingBottom).toBe("0px");
    expect(a2?.style.paddingBottom).toBe("10px");
    expect(a3?.style.paddingBottom).toBe("10px");
  });

  it("does not wrap the user message in any run class", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessage("first assistant", "a1"),
      MockDataGenerator.createAssistantMessage("second assistant", "a2"),
      MockDataGenerator.createUserMessage("a user question", "u1"),
      MockDataGenerator.createAssistantMessage("third assistant", "a3"),
    ];
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(getContainer().querySelector(".virtual-row")).not.toBeNull(),
    );

    const userRow = rowById("u1");
    expect(userRow).not.toBeNull();
    // The user message is its own virtual row, outside any timeline run.
    expect(userRow?.classList.contains("timeline-run--start")).toBe(false);
    expect(userRow?.classList.contains("timeline-run--end")).toBe(false);
    expect(userRow?.classList.contains("timeline-run--single")).toBe(false);
  });
});
