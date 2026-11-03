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
    // abut; the single row keeps the inter-message spacing (14px).
    expect(a1?.style.paddingBottom).toBe("0px");
    expect(a2?.style.paddingBottom).toBe("14px");
    expect(a3?.style.paddingBottom).toBe("14px");
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

  // 「把本轮转到后台」按钮只在这一轮还有可后台工具在跑时出现，挂在 `.message`
  // 末尾——它一出现，最后一个 `.timeline-row` 就不再是 `:last-child`，收尾的
  // `height: 21px` 规则会失效、整行画满竖线；工具跑完按钮消失，竖线又缩回去。
  // 行上的首/末标记因此不能靠 CSS 的 `:first-child` / `:last-child`。
  function messageElement(id: string) {
    return getContainer().querySelector<HTMLElement>(
      `[data-message-id="${id}"]`,
    );
  }

  it("marks the first/last dot row itself, unaffected by the trailing action button", async () => {
    renderChatApp();

    const running = MockDataGenerator.createAssistantMessageWithTool(
      "我来推送镜像并部署",
      "Bash",
      '{"command":"docker push"}',
    );
    running.id = "a1";
    const messages = [MockDataGenerator.createUserMessage("go", "u1"), running];
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(getContainer().querySelector(".virtual-row")).not.toBeNull(),
    );

    const message = messageElement("a1")!;
    // 前置条件：工具在跑 → 「转到后台」按钮存在，且它是消息的最后一个子元素。
    const actionButton = message
      .querySelector('[data-testid="background-current-task"]')
      ?.closest(".message-actions");
    expect(actionButton).not.toBeNull();
    expect(message.lastElementChild).toBe(actionButton);

    const rows = Array.from(message.querySelectorAll(".timeline-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains("timeline-row--first")).toBe(true);
    expect(rows[0].classList.contains("timeline-row--last")).toBe(false);
    expect(rows[1].classList.contains("timeline-row--last")).toBe(true);

    // 跑完：按钮消失，末尾标记必须还落同一行上。
    const done = MockDataGenerator.createAssistantMessageWithTool(
      "我来推送镜像并部署",
      "Bash",
      '{"command":"docker push"}',
      "pushed",
    );
    done.id = "a1";
    act(() => {
      sendCommand("updateMessages", {
        messages: [MockDataGenerator.createUserMessage("go", "u1"), done],
      });
    });
    await waitFor(() =>
      expect(
        messageElement("a1")?.querySelector(
          '[data-testid="background-current-task"]',
        ),
      ).toBeNull(),
    );

    const doneRows = Array.from(
      messageElement("a1")!.querySelectorAll(".timeline-row"),
    );
    expect(doneRows[0].classList.contains("timeline-row--first")).toBe(true);
    expect(doneRows[1].classList.contains("timeline-row--last")).toBe(true);
  });
});
