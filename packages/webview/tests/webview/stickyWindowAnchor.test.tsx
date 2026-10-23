import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";

/**
 * 吸顶条只在**已加载的窗口**里找锚点（`computeSticky`），而宿主首屏只推最近一页
 * （`MESSAGE_FIRST_PAGE_SIZE = 20`，spec ui/message-rendering-system.md「首屏只进一页」）。
 * 一轮任务产生的消息数可以超过一页（工具阶段一条一条往上加，注入的 `isMeta` 用户
 * 消息也占原始列表的位置），于是窗口从**一轮对话的中间**开始：用户自己那条消息不在
 * 窗口里，吸顶条没有锚点、整条不渲染，读者再也看不到「这段回答在回答我哪句话」，
 * 得自己上翻一页才回来（spec「首屏只进一页」场景 5）。
 *
 * 一页撑满头一页时「没撑满就没法滚、也就没法翻」那条 fill 规则不触发，所以这些用例
 * 都让容器**溢出**（2000 > 400）：能请求到更早一页，只可能是「这一页没有锚点」。
 */

const user = (id: string, content: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const assistant = (id: string, content: string) => ({
  id,
  role: "assistant" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

// 后台任务通知：user 角色但没有 text 块，渲染不出吸顶文案，也不能当锚点
// （computeSticky 会跳过它继续往上找）。
const notif = (id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [
    {
      type: "task_notification" as const,
      taskId: "task_1",
      taskType: "shell" as const,
      status: "completed" as const,
      summary: "Command completed with exit code 0",
      outputFile: "/tmp/task.log",
    },
  ],
});

/** 一轮任务超过一页：首屏推的是最近 20 条，全部是这一轮的工具阶段输出。 */
const midTurnWindow = Array.from({ length: 20 }, (_, i) =>
  assistant(`a${String(i)}`, `工具阶段 ${String(i)}`),
);

/** 再往上一页才有用户自己那条消息，和它的回答的开头。 */
const anchorPage = [
  user("u-anchor", "我写给 AI 的最新一条消息"),
  assistant("a-anchor", "回答的开头…"),
];

interface PostMessage {
  mock: { calls: unknown[][] };
}

const loadOlderRequests = (postMessage: PostMessage) =>
  postMessage.mock.calls
    .map(
      ([message]) =>
        message as { command?: string; before?: string; requestId?: number },
    )
    .filter((message) => message.command === "loadOlderMessages");

/** jsdom 不做布局：这三个值是 0，`scrollHeight === 0` 会被当成「还没布局」。 */
function fakeGeometry(
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 400,
) {
  const container = screen.getByTestId("messages-container");
  const props = { scrollTop, scrollHeight, clientHeight };
  for (const key of Object.keys(props) as (keyof typeof props)[]) {
    Object.defineProperty(container, key, {
      value: props[key],
      configurable: true,
      writable: true,
    });
  }
  return container;
}

/**
 * 绑定一条「窗口从一轮中间开始」的会话（宿主首屏的形状：20 条尾页 + 还有更早的
 * + 声明支持分页）。
 */
async function openMidTurnWindow(messages: unknown[] = midTurnWindow) {
  const { vscode } = renderChatApp();
  act(() => {
    sendCommand("setInitialState", {
      messages,
      historyExhausted: false,
      supportsMessagePaging: true,
      sessions: [],
      isStreaming: false,
    });
  });
  await waitFor(() => {
    expect(screen.getByTestId("messages-container")).toBeInTheDocument();
  });
  return vscode.postMessage as unknown as PostMessage;
}

/**
 * 让自动续页的 effect 带着**新的几何**再跑一次：几何是测试里手写进去的，改动它不
 * 触发 React 更新，所以用一次「同一份窗口的新数组」把 effect 带回来（reducer 按引用
 * 判断列表变没变）。`hasMore` 直接决定「还有没有更早的」这一事实（= 宿主说到没到
 * 历史起点），不传就是还有。
 */
function reenterWithSameWindow(
  messages: unknown[] = midTurnWindow,
  hasMore = true,
) {
  act(() => {
    sendCommand("updateMessages", { messages: [...messages], hasMore });
  });
}

const replyWith = (
  requestId: number,
  messages: unknown[],
  hasMore: boolean,
) => {
  act(() => {
    sendCommand("olderMessages", { requestId, messages, hasMore });
  });
};

describe("sticky anchor across the first page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the page above a window that holds no user message", async () => {
    const postMessage = await openMidTurnWindow();
    fakeGeometry(0, 2000, 400);
    reenterWithSameWindow();

    await waitFor(() => {
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    });
    // 取的是这一页**之前**的那段：窗口头那条消息作锚点，宿主不会重发它。
    expect(loadOlderRequests(postMessage)[0]).toMatchObject({ before: "a0" });
  });

  it("shows the bar again once that page brings the user message back", async () => {
    const postMessage = await openMidTurnWindow();
    fakeGeometry(0, 2000, 400);
    reenterWithSameWindow();
    await waitFor(() => {
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    });

    // 页面回来之前：窗口里一条用户消息都没有，吸顶条没有锚点。
    expect(screen.queryByTestId("sticky-user-message")).toBeNull();

    const { requestId } = loadOlderRequests(postMessage)[0] ?? {};
    replyWith(requestId as number, anchorPage, true);

    expect(
      screen.getAllByText("我写给 AI 的最新一条消息").length,
    ).toBeGreaterThan(0);
    // 滚到这条用户消息之下，它就是吸顶候选（行高按 jsdom 的 600 估算：
    // u-anchor 10..610、a-anchor 610..1210、a0 起于 1210）。
    const container = fakeGeometry(1300, 2600, 400);
    act(() => {
      fireEvent.scroll(container);
    });

    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "我写给 AI 的最新一条消息",
      );
    });
  });

  it("counts only a text-bearing user row as the anchor", async () => {
    // 任务通知也是 user 角色，但它渲染不出吸顶文案——把它当锚点就等于让吸顶条
    // 永远空着。判据必须和 computeSticky 同一条（带 text 的可见 user 行）。
    const withNotif = [
      assistant("a0", "工具阶段 0"),
      notif("n1"),
      ...midTurnWindow.slice(1),
    ];
    const postMessage = await openMidTurnWindow(withNotif);
    fakeGeometry(0, 2000, 400);
    reenterWithSameWindow(withNotif);

    await waitFor(() => {
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    });
  });

  it("leaves a single-turn window alone", async () => {
    // 只有一轮：用户那条就在窗口里，没有理由再往前取页，也不能在顶上多挂一条
    // 重复的「我写的消息」。
    const singleTurn = [user("u1", "只问了一句"), assistant("a1", "回答")];
    const postMessage = await openMidTurnWindow(singleTurn);
    fakeGeometry(0, 2000, 400);
    reenterWithSameWindow(singleTurn);

    // 给它足够的轮次把任何迟到的请求发出来。
    await act(async () => {});
    expect(loadOlderRequests(postMessage)).toHaveLength(0);

    const container = fakeGeometry(700, 2000, 400);
    act(() => {
      fireEvent.scroll(container);
    });
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "只问了一句",
      );
    });
    // 一条，不是两条：吸顶条只是在滚出去之后替换一次呈现，不是另挂一份。
    expect(screen.getAllByTestId("sticky-user-message")).toHaveLength(1);
    expect(document.querySelectorAll(".sticky-user-wrapper")).toHaveLength(1);
  });

  it("does not ask a window that is already at the beginning of history", async () => {
    // 宿主已经说了前面没有了：没有锚点也没得取，停在原地。
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("setInitialState", {
        messages: midTurnWindow,
        historyExhausted: true,
        supportsMessagePaging: true,
        sessions: [],
        isStreaming: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("messages-container")).toBeInTheDocument();
    });
    const postMessage = vscode.postMessage as unknown as PostMessage;
    fakeGeometry(0, 2000, 400);
    // 窗口照旧带 hasMore=false：宿主说这就是全部了。
    reenterWithSameWindow(midTurnWindow, false);
    await act(async () => {});

    expect(loadOlderRequests(postMessage)).toHaveLength(0);
  });

  it("asks once, even when the page also fails to fill the pane", async () => {
    // 两条自动续页规则在同一种形状上重叠（没有锚点 + 一页撑不满）：还是只发一次。
    const postMessage = await openMidTurnWindow();
    fakeGeometry(0, 300, 400);
    reenterWithSameWindow();

    await waitFor(() => {
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    });
    await act(async () => {});
    expect(loadOlderRequests(postMessage)).toHaveLength(1);
  });

  it("does not retry the same window head after the host answers with an error", async () => {
    // 失败就是失败：位置不动，也不在同一页头上反复打宿主（loadingOlder 一回落，
    // effect 会再跑一遍，判据必须自己认出「这个头已经问过了」）。
    const postMessage = await openMidTurnWindow();
    fakeGeometry(0, 2000, 400);
    reenterWithSameWindow();
    await waitFor(() => {
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    });

    const { requestId } = loadOlderRequests(postMessage)[0] ?? {};
    act(() => {
      sendCommand("olderMessagesError", {
        requestId,
        error: "session not found",
      });
    });
    await act(async () => {});

    expect(loadOlderRequests(postMessage)).toHaveLength(1);
    expect(screen.queryByTestId("sticky-user-message")).toBeNull();
  });

  it("keeps the bar inside the virtualized list", async () => {
    // 现在的列表没有「普通分支」：容器 class 恒带 messages-container--virtual，
    // 吸顶条与行都在同一个滚动流里（sticky 才跟着视口走）。
    const singleTurn = [
      user("u1", "只问了一句"),
      assistant("a1", "回答"),
      user("u2", "又问一句"),
      assistant("a2", "再回答"),
    ];
    await openMidTurnWindow(singleTurn);
    const container = fakeGeometry(700, 2000, 400);
    act(() => {
      fireEvent.scroll(container);
    });
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument();
    });

    expect(container.className).toContain("messages-container--virtual");
    const wrapper = container.querySelector(".sticky-user-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.contains(screen.getByTestId("sticky-user-message"))).toBe(
      true,
    );
  });
});
