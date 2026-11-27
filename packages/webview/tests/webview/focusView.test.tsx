import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  fireEvent,
  sendCommand,
  pinMessageListViewport,
  transcriptText,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import { writeFocusViewPreference } from "../../src/utils/displayPreferences";

const FOCUS_KEY = "wave.chat.focusView";

/**
 * 聚焦视图（spec ui/focus-view.md）。
 *
 * 断言落在「布局项」上：折叠行的存在、卡内外分别有哪些消息、开关的
 * aria-pressed 与持久化。像素级行高与滚动行为由 tests/virtual/* 覆盖 —— 这里
 * 只钉住「折叠改的是布局，不是消息」，以及开关的定义域。
 */
describe("聚焦视图", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  /** 一轮带两次工具调用 + 轮尾答复，后面再跟一轮，用来验证折叠范围。 */
  function conversation() {
    return [
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "",
        "Read",
        "{}",
        "文件内容",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "",
        "Write",
        "{}",
        "写入成功",
      ),
      MockDataGenerator.createAssistantMessage("第一轮的答复", "a3"),
      MockDataGenerator.createUserMessage("第二问", "u2"),
      MockDataGenerator.createAssistantMessage("第二轮的答复", "a4"),
    ];
  }

  async function renderWith(messages: ReturnType<typeof conversation>) {
    const result = renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    pinMessageListViewport(screen.getByTestId("messages-container"));
    return result;
  }

  it("默认关闭：每条消息各占一行，没有任何折叠卡", async () => {
    await renderWith(conversation());

    await waitFor(() => expect(transcriptText()).toContain("第一轮的答复"));
    expect(screen.queryAllByTestId("focus-fold")).toHaveLength(0);
    expect(transcriptText()).toContain("第一问");
  });

  it("开着进页面：这一轮收成一张卡，轮尾答复仍留在卡外", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith(conversation());

    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    const fold = screen.getByTestId("focus-fold");
    expect(fold.textContent).toContain("2 次工具调用");
    // 卡外的两问一答（第一轮答复 + 第二轮）照常显示。
    await waitFor(() => expect(transcriptText()).toContain("第一轮的答复"));
    expect(transcriptText()).toContain("第二轮的答复");
    // 卡内消息收起时不渲染。
    expect(screen.queryByTestId("focus-fold-body")).toBeNull();
  });

  it("点卡头展开这一轮，再点收起", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith(conversation());
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(screen.getByTestId("focus-fold-body")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("focus-fold-head").getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(screen.queryByTestId("focus-fold-body")).toBeNull(),
    );
    expect(
      screen.getByTestId("focus-fold-head").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("轮尾那条消息里思考与答复并存时，思考收进卡、卡外只留答复", async () => {
    // 真实会话里常见：一条 assistant 消息 blocks = [reasoning, text]。折叠粒度
    // 若按整条消息算，思考就跟着答复一起露在卡外（spec 场景 2 按块切）。
    window.localStorage.setItem(FOCUS_KEY, "1");
    const tail = MockDataGenerator.createAssistantMessage("重跑还在跑", "a2");
    tail.blocks = [
      {
        type: "reasoning",
        content: "重跑的 agent-sdk 2 pending",
        stage: "end",
      },
      { type: "text", content: "重跑还在跑", stage: "end" },
    ];
    await renderWith([
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "",
        "Read",
        "{}",
        "文件内容",
      ),
      tail,
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    // 卡外只有答复，思考行不在卡外。
    expect(transcriptText()).toContain("重跑还在跑");
    expect(document.querySelectorAll(".reasoning-block")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(screen.getByTestId("focus-fold-body")).toBeInTheDocument(),
    );
    // 展开卡后思考才出现，且仍在卡内。
    expect(document.querySelectorAll(".reasoning-block")).toHaveLength(1);
    expect(screen.getByTestId("focus-fold-body").textContent).toContain("思考");
  });

  it("一轮里上百次工具调用也只收成一行，DOM 行数仍然有界", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    const messages = [MockDataGenerator.createUserMessage("干一大票", "u1")];
    for (let i = 0; i < 200; i++) {
      messages.push(
        MockDataGenerator.createAssistantMessageWithTool(
          "",
          "Read",
          "{}",
          "ok",
        ),
      );
    }
    // 轮尾答复：这一轮已经结束，卡头才是结算文案。
    messages.push(MockDataGenerator.createAssistantMessage("答复", "a-end"));

    await renderWith(messages);

    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    expect(screen.getByTestId("focus-fold").textContent).toContain(
      "200 次工具调用",
    );
    const container = screen.getByTestId("messages-container");
    await waitFor(() =>
      expect(container.querySelectorAll(".virtual-row").length).toBeLessThan(
        50,
      ),
    );
  });

  it("搜索命中落在被折叠的活动里时，这一轮自动展开并滚到命中", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith([
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool("", "Read", "{}", "ok"),
      MockDataGenerator.createAssistantMessageWithTool(
        "needle 在这一步",
        "Write",
        "{}",
        "ok",
      ),
      MockDataGenerator.createAssistantMessage("第一轮的答复", "a3"),
    ]);
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    expect(screen.queryByTestId("focus-fold-body")).toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    const input = await screen.findByTestId("transcript-find-input");
    fireEvent.change(input, { target: { value: "needle" } });

    // 命中在被收起的那一轮里：计数照真实消息统计，卡片自己展开让人看见。
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/1",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("focus-fold-body")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("focus-fold-body").textContent).toContain(
      "needle 在这一步",
    );
  });

  it("进行中的一轮又长出新消息时，用户展开的卡不会被收回去", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    const first = [
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool("", "Read", "{}", "ok"),
      MockDataGenerator.createAssistantMessageWithTool("", "Write", "{}"),
    ];
    await renderWith(first);
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(screen.getByTestId("focus-fold-body")).toBeInTheDocument(),
    );

    // 同一轮又跑完一次工具：卡的内容变长，但「展开着」这个事实必须留着。
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          ...first,
          MockDataGenerator.createAssistantMessageWithTool(
            "",
            "Bash",
            "{}",
            "ok",
          ),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    expect(screen.getByTestId("focus-fold-body")).toBeInTheDocument();
    // 这一轮还没结束：卡头保持进行态，轮内不出任何计数（避免文案来回抖）。
    const text = screen.getByTestId("focus-fold").textContent ?? "";
    expect(text).toMatch(/正在(执行|思考)/);
    expect(text).not.toContain("次工具调用");
  });

  it("设置页改完开关，已挂载的聊天视图立刻跟着折叠（不用刷新）", async () => {
    await renderWith(conversation());
    // 聊天界面上没有入口：顶栏与输入框工具行都不该出现这个开关（2026-11-27
    // 拍板把入口收进设置页）。设置页那一行本身由 settingsGlobal.test.tsx 钉住。
    expect(screen.queryByTestId("focus-view-toggle")).toBeNull();
    expect(screen.queryAllByTestId("focus-fold")).toHaveLength(0);

    // 设置页写的就是这颗偏好：同页面走 listeners、桌面端独立设置窗口走 storage
    // 事件，两条都汇到 subscribeFocusViewPreference。
    act(() => {
      writeFocusViewPreference(true);
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );

    act(() => {
      writeFocusViewPreference(false);
    });
    await waitFor(() =>
      expect(screen.queryAllByTestId("focus-fold")).toHaveLength(0),
    );
  });

  it("这一轮以失败提示收尾时，提示留在卡外原样可见", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith([
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "",
        "Read",
        "{}",
        "文件内容",
      ),
      MockDataGenerator.createErrorMessage("模型报错了"),
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    // 失败提示是「轮尾答复」：不含工具块，按轮尾规则留在卡外。折叠不能把
    // 报错吞进摘要里 —— 用户必须在流里看见这一轮失败了。
    expect(transcriptText()).toContain("模型报错了");
    expect(screen.getByTestId("focus-fold").textContent).toContain(
      "1 次工具调用",
    );
  });
});
