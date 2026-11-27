import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  sendHostMessage,
  fixtures,
  fireInput,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * `/context` 浮层（spec commands/context-command.md 用户故事 2）。
 *
 * 断言锚在 testid 与语义上：分段条 / 分类行 / 明细分组的契约是「按 id 渲染、
 * 按 kind 决定百分比列」，与显示名无关。形态是**锚在用量环上的非模态浮层**，
 * 所以这里也锚 `position: fixed`（居中覆盖层会挂 overlay 容器）。
 */

const WINDOW = 200_000;

function makeBreakdown(overrides: Record<string, unknown> = {}) {
  return {
    model: "wave-pro",
    contextWindow: WINDOW,
    autoCompactThreshold: 179_000,
    maxOutputTokens: 8_000,
    usedTokens: 60_000,
    measured: true,
    usedPercent: 30,
    categories: [
      {
        id: "systemPrompt",
        kind: "used",
        name: "System prompt",
        tokens: 8_000,
      },
      { id: "systemTools", kind: "used", name: "System tools", tokens: 12_000 },
      { id: "mcpTools", kind: "used", name: "MCP tools", tokens: 20_000 },
      { id: "memory", kind: "used", name: "Memory files", tokens: 5_000 },
      { id: "skills", kind: "used", name: "Skills", tokens: 400 },
      { id: "agents", kind: "used", name: "Custom agents", tokens: 120 },
      { id: "messages", kind: "used", name: "Messages", tokens: 15_000 },
      {
        id: "buffer",
        kind: "buffer",
        name: "Autocompact buffer",
        tokens: 21_000,
      },
      { id: "free", kind: "free", name: "Free space", tokens: 119_000 },
    ],
    mcpTools: [
      { serverName: "github", name: "mcp__github__search", tokens: 20_000 },
    ],
    systemTools: [
      { name: "Bash", tokens: 900 },
      { name: "Read", tokens: 600 },
    ],
    memoryFiles: [{ type: "project", path: "/repo/AGENTS.md", tokens: 5_000 }],
    skills: [{ name: "spec", tokens: 400 }],
    agents: [{ name: "Explore", tokens: 120 }],
    errors: [],
    ...overrides,
  };
}

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

async function openContext() {
  await act(async () => {
    await typeAndSend("/context");
  });
  await waitFor(() => {
    expect(screen.getByTestId("context-dialog")).toBeInTheDocument();
  });
}

/** 面板最近一次发出的 requestId —— 回复必须原样带上它才会被收下。 */
function lastRequestId(vscode: {
  postMessage: ReturnType<typeof vi.fn>;
}): string {
  const request = vscode.postMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((message) => message.command === "getContextBreakdown")
    .pop();
  return String(request?.requestId ?? "");
}

/** 会话进行中 + 宿主已推送用量：这是用量环唯一会渲染的状态。 */
function startConversationWithRing(percent = 45) {
  sendHostMessage(
    fixtures.setInitialState({
      session: {
        id: "session-a",
        sessionType: "main" as const,
        workdir: "/tmp/test",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
      messages: [MockDataGenerator.createUserMessage("hello", "msg-a")],
    }),
  );
  sendHostMessage(fixtures.contextUsage(percent));
  const ring = document.querySelector(".compress-context-button");
  expect(ring).not.toBeNull();
  return ring as HTMLElement;
}

describe("/context command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("打字输入 /context 打开面板并请求宿主取数（不把命令发给模型）", async () => {
    const { vscode } = renderChatApp();

    await openContext();

    const asked = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((message) => message.command === "getContextBreakdown");
    expect(asked).toHaveLength(1);
    // 命令本身不进对话：发给宿主的 sendMessage 里没有 `/context`。
    const sent = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((message) => message.command === "sendMessage");
    expect(sent.map((message) => message.text)).not.toContain("/context");
  });

  it("点用量环也打开同一个浮层（两个入口同形态、同一条取数路径）", async () => {
    const { vscode } = renderChatApp();
    // 环只在「非欢迎页 + 宿主已推送用量」时渲染（spec ui/context-usage-indicator 场景 1/3）。
    const ring = startConversationWithRing();
    await act(async () => {
      fireEvent.click(ring);
    });

    const dialog = await screen.findByTestId("context-dialog");
    // 非模态浮层：fixed 定位在环旁边，不是居中覆盖层。
    expect(dialog.style.position).toBe("fixed");
    // 不压住输入框：底边停在输入框上沿之外（锚点取 composer 顶而不是环，环
    // 长在输入框里面，从环展开会把输入框上半截盖掉）。
    const composerRect = document
      .querySelector(".input-wrapper")!
      .getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    expect(dialogRect.bottom).toBeLessThanOrEqual(composerRect.top);
    // 横向左对齐输入框左缘：与 .rewind-popup / .btw-panel / .model-picker-menu
    // 同一族。右对齐到环会让浮层悬在中间、右边一条空白。
    expect(Math.abs(dialogRect.left - composerRect.left)).toBeLessThanOrEqual(
      1,
    );
    expect(
      vscode.postMessage.mock.calls
        .map((call) => call[0] as Record<string, unknown>)
        .filter((message) => message.command === "getContextBreakdown"),
    ).toHaveLength(1);
  });

  it("浮层开着时再点一次环即收起", async () => {
    renderChatApp();
    const ring = startConversationWithRing();
    // 真实点击序列 = mousedown + click：mousedown 会先喂给「点外部关闭」，环必须
    // 被豁免（否则先关后开，收起永远做不到，还会重取一次数）。
    const pressRing = async () => {
      await act(async () => {
        fireEvent.mouseDown(ring);
        fireEvent.click(ring);
      });
    };

    await pressRing();
    expect(screen.getByTestId("context-dialog")).toBeInTheDocument();
    // useClickOutside 的监听器延迟一帧注册，等它挂上再点第二下才有意义。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 环本身被豁免：mousedown 落在环上不算「点外部」（否则收起前会先闪一下关闭，
    // 折叠状态与取数都白重来一遍）。
    await act(async () => {
      fireEvent.mouseDown(ring);
    });
    expect(screen.getByTestId("context-dialog")).toBeInTheDocument();

    await pressRing();
    expect(screen.queryByTestId("context-dialog")).not.toBeInTheDocument();
  });

  it("数据到达后按 id 渲染色块、tokens 与百分比；free/buffer 的百分比列是 —", async () => {
    const { vscode } = renderChatApp();
    await openContext();

    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        breakdown: makeBreakdown(),
      });
    });

    const mcpRow = screen.getByTestId("context-category-mcpTools");
    expect(mcpRow.textContent).toContain("MCP 工具");
    expect(mcpRow.textContent).toContain("20,000");
    expect(mcpRow.textContent).toContain("10.0%");

    // free / buffer 不占对话可用量 ⇒ 百分比列 `—`（判据是 kind，不是名字）。
    expect(screen.getByTestId("context-category-free").textContent).toContain(
      "—",
    );
    expect(screen.getByTestId("context-category-buffer").textContent).toContain(
      "—",
    );
  });

  it("面板中文化：标题、分类名、阈值脚注都不再是英文", async () => {
    const { vscode } = renderChatApp();
    await openContext();
    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        breakdown: makeBreakdown(),
      });
    });

    // 分类名按 id 映射（SDK 的 name 与 CLI 报告共用，不能就地翻译）。
    expect(document.querySelector(".context-popover-title")?.textContent).toBe(
      "上下文窗口",
    );
    expect(
      screen.getByTestId("context-category-systemPrompt").textContent,
    ).toContain("系统提示词");
    expect(screen.getByTestId("context-category-free").textContent).toContain(
      "剩余空间",
    );
    // 阈值那行补上「占窗口多少」——CLI 报告本来就有这半句，面板此前没有。
    expect(document.querySelector(".context-threshold")?.textContent).toContain(
      "自动压缩于 179,000 tokens（占窗口 89.5%）",
    );
  });

  it("明细分组默认折叠，点开后列出各行", async () => {
    const { vscode } = renderChatApp();
    await openContext();
    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        breakdown: makeBreakdown(),
      });
    });

    const group = screen.getByTestId("context-group-mcp");
    expect(group.textContent).toContain("1 · 20,000 tokens");
    expect(group.textContent).not.toContain("mcp__github__search");

    await act(async () => {
      fireEvent.click(group.querySelector("button") as HTMLElement);
    });

    expect(screen.getByTestId("context-group-mcp").textContent).toContain(
      "mcp__github__search",
    );
  });

  it("技能与子代理清单各自成组，标出行数与合计", async () => {
    const { vscode } = renderChatApp();
    await openContext();
    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        breakdown: makeBreakdown(),
      });
    });

    expect(screen.getByTestId("context-group-skills").textContent).toContain(
      "1 · 400 tokens",
    );
    expect(screen.getByTestId("context-group-agents").textContent).toContain(
      "1 · 120 tokens",
    );
    // 分类行也按 id 出现（不是靠名字匹配）。
    expect(screen.getByTestId("context-category-skills").textContent).toContain(
      "技能",
    );
    expect(screen.getByTestId("context-category-agents").textContent).toContain(
      "自定义代理",
    );
  });

  it("明细超过 6 条时截成前 5 条 + Other", async () => {
    const { vscode } = renderChatApp();
    await openContext();

    const systemTools = Array.from({ length: 9 }, (_, index) => ({
      name: `tool-${index}`,
      tokens: 1_000 - index,
    }));
    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        breakdown: makeBreakdown({ systemTools }),
      });
    });

    await act(async () => {
      fireEvent.click(
        screen
          .getByTestId("context-group-system")
          .querySelector("button") as HTMLElement,
      );
    });

    const rows = screen
      .getByTestId("context-group-system")
      .querySelectorAll(".context-detail-row");
    expect(rows).toHaveLength(6);
    expect(rows[5].textContent).toContain("其他（4 项）");
  });

  it("新会话（没有消息、也没有实测）显示空态而不是 0% 的分段条", async () => {
    const { vscode } = renderChatApp();
    await openContext();

    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        breakdown: makeBreakdown({
          usedTokens: 0,
          measured: false,
          categories: [
            {
              id: "buffer",
              kind: "buffer",
              name: "Autocompact buffer",
              tokens: 21_000,
            },
            { id: "free", kind: "free", name: "Free space", tokens: 179_000 },
          ],
          mcpTools: [],
          systemTools: [],
          memoryFiles: [],
        }),
      });
    });

    expect(screen.getByTestId("context-dialog").textContent).toContain(
      "发一条消息后即可看到上下文占用。",
    );
  });

  it("宿主回 error 时显示失败与重试，而不是空面板", async () => {
    const { vscode } = renderChatApp();
    await openContext();

    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: lastRequestId(vscode),
        error: "Method not found",
      });
    });

    const dialog = screen.getByTestId("context-dialog");
    expect(dialog.textContent).toContain("Method not found");
    expect(dialog.textContent).toContain("重试");

    await act(async () => {
      fireEvent.click(screen.getByText("重试"));
    });
    const asked = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((message) => message.command === "getContextBreakdown");
    expect(asked).toHaveLength(2);
  });

  it("晚到的旧回复按 requestId 丢弃", async () => {
    const { vscode } = renderChatApp();
    await openContext();

    const first = lastRequestId(vscode);
    // 浮层重开一次（新的 requestId），随后第一笔的回复才到达。
    await act(async () => {
      fireEvent.click(screen.getByLabelText("关闭"));
    });
    await openContext();
    const second = lastRequestId(vscode);
    expect(second).not.toBe(first);

    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: first,
        breakdown: makeBreakdown({ model: "stale-model" }),
      });
    });
    expect(screen.getByTestId("context-dialog").textContent).not.toContain(
      "stale-model",
    );

    await act(async () => {
      sendCommand("contextBreakdownResponse", {
        requestId: second,
        breakdown: makeBreakdown({ model: "fresh-model" }),
      });
    });
    expect(screen.getByTestId("context-dialog").textContent).toContain(
      "fresh-model",
    );
  });

  /**
   * 宽度：460 是上限，对话区（输入卡）比它窄时跟着收窄
   * （设计师 2026-11-18 点 `div.context-popover`：「这里是最大值，在AI对话区域
   * 宽度不足时，要跟着收窄，文本重叠时省略展示」）。收窄后谁让位由 CSS 决定
   * （名称列省略、数字列不缩），这里只钉宽度这条几何。
   */
  it("对话区比 460 窄时浮层跟着收窄，更宽时仍按 460 的上限", async () => {
    const composer = () => document.querySelector(".input-wrapper")!;
    const realRect = Element.prototype.getBoundingClientRect;
    /** 只改输入卡的量测（锚点与宽度都从它身上取），其余元素保持真实布局。 */
    const fakeComposerWidth = (width: number) => {
      Element.prototype.getBoundingClientRect = function (
        this: Element,
      ): DOMRect {
        if (this !== composer()) return realRect.call(this);
        const left = 40;
        return {
          x: left,
          y: 700,
          top: 700,
          left,
          right: left + width,
          bottom: 800,
          width,
          height: 100,
          toJSON: () => ({}),
        } as DOMRect;
      };
    };
    const dialogWidth = async () => {
      const { unmount } = renderChatApp();
      const ring = startConversationWithRing();
      await act(async () => {
        fireEvent.click(ring);
      });
      const dialog = await screen.findByTestId("context-dialog");
      const width = parseFloat(dialog.style.width);
      unmount();
      return width;
    };

    try {
      fakeComposerWidth(320);
      expect(await dialogWidth()).toBeCloseTo(320, 0);
      fakeComposerWidth(768);
      expect(await dialogWidth()).toBeCloseTo(460, 0);
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
    }
  });
});
