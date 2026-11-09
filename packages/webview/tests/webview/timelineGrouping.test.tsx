import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Message } from "wave-agent-sdk";
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

  /**
   * 一条已经建出来、但还没有任何可渲染块的消息——流式刚开始那一刻的状态。
   *
   * codechat 网关上的 Claude 思考明文恒为空（只回 signature），流式期第一个
   * `thinking_delta` 是空串，SDK 于是在真内容到达前几百毫秒到几秒就先建出一条
   * `blocks: []` 的助手消息。这种消息若进渲染列表：时间线的收尾规则
   * （`.timeline-run--end` × `.timeline-row--last`）落在它身上，而它内部没有
   * `.timeline-row`，前一条真实消息的最后一行于是保持全高线段——连线一路垂到
   * 列表底部；它自己还占着基础行高与 14px 消息间距。所以它在 `visibleMessages`
   * 里就被滤掉，连虚拟行都不该有。
   */
  function blankAssistant(id: string): Message {
    return {
      id,
      role: "assistant",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [],
    };
  }

  it("一条还没有块的消息不出外壳，也不吃时间线的收尾", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("go", "u1"),
      MockDataGenerator.createAssistantMessage("first assistant", "a1"),
      MockDataGenerator.createAssistantMessage("second assistant", "a2"),
      blankAssistant("blank"),
    ];
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(getContainer().querySelector(".virtual-row")).not.toBeNull(),
    );

    // 一个节点都不出：既没有 `.message` 外壳（连线与底部间距的元凶），也没有
    // 那一行虚拟行（不占行高、不占消息间距）。
    expect(messageElement("blank")).toBeNull();
    expect(rowById("blank")).toBeNull();
    // 收尾落在最后一条真实消息上，而不是那条空消息上。
    expect(messageElement("a2")).not.toBeNull();
    expect(rowById("a2")?.classList.contains("timeline-run--end")).toBe(true);
    // 段内上一行仍保持 flush（收尾的 14px 间距在 a2 上）。
    expect(rowById("a1")?.style.paddingBottom).toBe("0px");
  });

  it("空消息出现在一轮的开头时，也不抢连线段的起始", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("go", "u1"),
      blankAssistant("blank"),
      MockDataGenerator.createAssistantMessage("first assistant", "a2"),
      MockDataGenerator.createAssistantMessage("second assistant", "a3"),
    ];
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(getContainer().querySelector(".virtual-row")).not.toBeNull(),
    );

    // 线段从第一条真实消息的圆点开始画，空消息根本没有行。
    expect(rowById("blank")).toBeNull();
    expect(rowById("a2")?.classList.contains("timeline-run--start")).toBe(true);
    expect(rowById("a3")?.classList.contains("timeline-run--end")).toBe(true);
  });
});
