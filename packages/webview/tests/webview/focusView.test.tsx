import { join } from "node:path";
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

  /** 一条 `SendUserFile` 响应：结果里带一个已落盘的文件（卡片据此渲染）。 */
  function deliveryMessage() {
    const message = MockDataGenerator.createAssistantMessageWithTool(
      "",
      "SendUserFile",
      "{}",
      "已交付",
    );
    const blocks = (message.blocks ?? []).map((block) =>
      block.type === "tool"
        ? {
            ...block,
            data: {
              attachments: [
                {
                  path: join("fake", "project", "report.md"),
                  name: "report.md",
                  kind: "text",
                },
              ],
            },
          }
        : block,
    );
    return { ...message, blocks };
  }

  async function renderWith(
    messages: ReturnType<typeof conversation>,
    options: { streaming?: boolean } = {},
  ) {
    const result = renderChatApp();
    // 进行态由宿主的 startStreaming 说了算（真信号）。必须挂在 mount 之后：
    // 消息监听是 ChatApp 挂载时装上的，先发就扔了。
    if (options.streaming) {
      act(() => {
        sendCommand("startStreaming");
      });
    }
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
    // 卡内活动收起时没有自己的行（只有卡头那一行）。
    expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(0);
  });

  it("点卡头展开这一轮，再点收起", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith(conversation());
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    // 展开 = 这一轮的两条活动各自回到虚拟列表（对齐 CC 的行粒度），
    // 不是把整轮塞进卡头那一行里。
    await waitFor(() =>
      expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(2),
    );
    expect(
      screen.getByTestId("focus-fold-head").getAttribute("aria-expanded"),
    ).toBe("true");
    // 时间线的两端落在卡内的真实活动上：起笔给第一条卡内行（卡头不画点），
    // 收口给最后一条卡内行（卡外答复不画点，线不能拉到它那里）。
    expect(
      document.querySelector("[data-in-fold].timeline-run--lead"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-in-fold].timeline-run--tail"),
    ).not.toBeNull();

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(0),
    );
    expect(
      screen.getByTestId("focus-fold-head").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("卡内只有一条活动时整段竖线关掉（两头都没有可连的对象）", async () => {
    // 一轮只有一次工具调用：展开后卡内就一行，它的上下都没有别的节点。线若照
    // 常画就是从节点往下的一截孤立短线 —— 宁可关掉（与 single run 同一档）。
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith([
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool("", "Read", "{}", "ok"),
      MockDataGenerator.createAssistantMessage("第一轮的答复", "a3"),
    ]);
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(1),
    );
    expect(
      document.querySelector("[data-in-fold].timeline-run--single"),
    ).not.toBeNull();
    expect(document.querySelector(".timeline-run--lead")).toBeNull();
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
      expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(2),
    );
    // 展开卡后思考才出现，且落在卡内那几行里（思考块的正文要再点开，
    // 这里只锚它作为一行已经渲染出来）。
    expect(document.querySelectorAll(".reasoning-block")).toHaveLength(1);
    expect(transcriptText()).toContain("思考");
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

  it("一轮 200 次工具调用展开后，DOM 里仍只有视口内那几行", async () => {
    // 展开不是「把 200 条一次性挂出来」：这一轮变成 201 个虚拟行，仍然只挂
    // 视口内的那几行（对齐 CC 桌面端 —— 展开就是把 step 放回列表）。
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
    messages.push(MockDataGenerator.createAssistantMessage("答复", "a-end"));

    await renderWith(messages);
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    const container = screen.getByTestId("messages-container");
    await waitFor(() =>
      expect(container.querySelectorAll(".virtual-row").length).toBeLessThan(
        50,
      ),
    );
    expect(container.querySelectorAll("[data-in-fold]").length).toBeLessThan(
      50,
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
    expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(0);

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
    // 卡展开后，命中所在的那条活动有自己的行了（虚拟列表里的一行）。
    await waitFor(() =>
      expect(
        document.querySelectorAll("[data-in-fold]").length,
      ).toBeGreaterThan(0),
    );
    expect(transcriptText()).toContain("needle 在这一步");
  });

  it("搜索命中落在轮尾那条消息的思考里时，装思考的那张卡也跟着展开", async () => {
    // 一条消息可以横跨两行：思考进卡、答复留卡外。搜索命中落在思考上时，
    // 若 reveal 只展开「消息坐标指向的那一行」（卡外的答复行），用户跳过去
    // 看到的是答复、思考仍收着 —— 等于没定位到（spec 场景 8）。
    window.localStorage.setItem(FOCUS_KEY, "1");
    const tail = MockDataGenerator.createAssistantMessage("这一轮的答复", "a2");
    tail.blocks = [
      { type: "reasoning", content: "needle 在思考里", stage: "end" },
      { type: "text", content: "这一轮的答复", stage: "end" },
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
    // 起始态：思考收在卡里，卡外只有答复。
    expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(0);
    expect(transcriptText()).toContain("这一轮的答复");

    act(() => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    const input = await screen.findByTestId("transcript-find-input");
    fireEvent.change(input, { target: { value: "needle" } });

    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count")).toHaveTextContent(
        "1/1",
      ),
    );
    // 命中在卡内的思考里：这张卡必须自己展开，否则命中的那段文本根本没渲染。
    await waitFor(() =>
      expect(
        document.querySelectorAll("[data-in-fold]").length,
      ).toBeGreaterThan(0),
    );
    expect(document.querySelectorAll(".reasoning-block")).toHaveLength(1);
  });

  it("进行中的一轮又长出新消息时，用户展开的卡不会被收回去", async () => {
    window.localStorage.setItem(FOCUS_KEY, "1");
    const first = [
      MockDataGenerator.createUserMessage("第一问", "u1"),
      MockDataGenerator.createAssistantMessageWithTool("", "Read", "{}", "ok"),
      MockDataGenerator.createAssistantMessageWithTool("", "Write", "{}"),
    ];
    await renderWith(first, { streaming: true });
    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    fireEvent.click(screen.getByTestId("focus-fold-head"));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(2),
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
    // 展开着的那三条活动又各自成行（新长出来的一条也进来了）。
    expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(3);
    // 这一轮还没结束：卡头保持进行态，轮内不出任何计数（避免文案来回抖）。
    const text = screen.getByTestId("focus-fold").textContent ?? "";
    expect(text).toMatch(/正在(执行|思考)/);
    expect(text).not.toContain("次工具调用");
  });

  it("中断的那一轮按已结束处理：宿主说停止后卡头切结算文案", async () => {
    // 复刻用户按 Esc：宿主推 endStreaming，而 SDK 之后**不再补任何消息** ——
    // 末条永远是「文本 + 已结束的失败工具块」。这一轮必须算结束（spec
    // ui/focus-view.md「失败与中断」），卡头从「正在思考…」切回结算文案并补上
    // 失败计数。#3159 只看末条形状，这一行会永久停在「正在思考…」+ 脉冲点。
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith(
      [
        MockDataGenerator.createUserMessage("第一问", "u1"),
        MockDataGenerator.createAssistantMessageWithToolError(
          "我先跑个命令",
          "Read",
          "{}",
          "Request was aborted",
        ),
      ],
      { streaming: true },
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    // 跑着的时候是进行态，且不出计数。
    expect(screen.getByTestId("focus-fold").textContent).toMatch(/正在/);
    expect(screen.getByTestId("focus-fold").textContent).not.toContain(
      "次工具调用",
    );

    act(() => {
      sendCommand("endStreaming");
    });

    await waitFor(() =>
      expect(screen.getByTestId("focus-fold").textContent).toContain(
        "1 次工具调用",
      ),
    );
    const text = screen.getByTestId("focus-fold").textContent ?? "";
    expect(text).not.toMatch(/正在/);
    // 中断时被 finalize 的那次工具调用按失败结算，计数要露出来。
    expect(text).toContain("1 个失败");
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

  it("交付的文件卡片不进折叠卡：不展开就能看到、能点", async () => {
    // spec ui/focus-view.md「交付内容」：交付是「结果」不是「过程」。模型交付完
    // 常常就收工，按「末条带工具块就整轮进卡」的老规则，卡片会被折进去 ——
    // 用户既看不见也点不到，交付等于没发生。
    window.localStorage.setItem(FOCUS_KEY, "1");
    await renderWith([
      MockDataGenerator.createUserMessage("帮我出报告", "u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "",
        "Read",
        "{}",
        "文件内容",
      ),
      deliveryMessage(),
    ]);

    await waitFor(() =>
      expect(screen.getAllByTestId("focus-fold")).toHaveLength(1),
    );
    // 卡是收着的，但卡片在卡外：文件名看得见、卡片可点。
    expect(document.querySelectorAll("[data-in-fold]")).toHaveLength(0);
    expect(transcriptText()).toContain("report.md");
    expect(document.querySelectorAll(".delivered-file")).toHaveLength(1);
    // 已交付的那次调用不计入摘要的调用数（卡片已经独立可见）。
    expect(screen.getByTestId("focus-fold").textContent).toContain(
      "1 次工具调用",
    );
  });
});
