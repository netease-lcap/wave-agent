import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixtures, type Message } from "wave-webview-fixtures";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  fireEvent,
  sendHostMessage,
} from "./test-utils";

/**
 * 上翻取更早（spec ui/message-rendering-system.md「首屏一页，上翻按需取更早」）：
 *
 * 首屏只装一页，滚动到离顶近了才向宿主再要一页；回包接在列表**前面**（不是替换），
 * 重复 id 丢弃，`hasMore=false` 之后不再自动要。锚点在转录里没了（`anchorLost`）
 * 时换已加载列表里的下一个 id 重试，而不是把这段历史判成「到底」。
 */
const msg = (id: string, content: string): Message => ({
  id,
  role: "user",
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const page = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    msg(`${prefix}-${i}`, `${prefix}-${i}`),
  );

/**
 * 用例问的是「读到某个滚动位置时会不会请求上一页」，位置必须精确可控：真排版下
 * scrollHeight 取决于行内容测量与列宽，凑不出「离顶 10px」这种边界。所以把三个
 * 几何量钉成给定值再派发一次 scroll，走的仍是组件里那个滚动处理器。
 */
function scrollTo(scrollTop: number, scrollHeight = 4000, clientHeight = 400) {
  const container = screen.getByTestId("messages-container");
  for (const [key, value] of [
    ["scrollTop", scrollTop],
    ["scrollHeight", scrollHeight],
    ["clientHeight", clientHeight],
  ] as const) {
    Object.defineProperty(container, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  act(() => {
    fireEvent.scroll(container);
  });
}

const earlierRequests = (vscode: {
  postMessage: { mock: { calls: unknown[][] } };
}) =>
  vscode.postMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((m) => m.command === "loadEarlierMessages") as Array<{
    command: string;
    before: string;
    requestId: string;
  }>;

const renderedIds = () =>
  Array.from(
    screen
      .getByTestId("messages-container")
      .querySelectorAll("[data-measured-message-id]"),
  )
    .map((node) => node.getAttribute("data-measured-message-id"))
    .filter((id): id is string => !!id);

/** 钉住容器的两个几何读数（不排版时量出来的值与用例要的边界对不上）。 */
function pinViewport(clientHeight: number, scrollHeight: number) {
  const container = screen.getByTestId("messages-container");
  for (const [key, value] of [
    ["clientHeight", clientHeight],
    ["scrollHeight", scrollHeight],
  ] as const) {
    Object.defineProperty(container, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

/** 首屏：一页 20 条，并告诉页面「更早的还有」。 */
function mountWithFirstPage(hasEarlier = true) {
  const ctx = renderChatApp();
  // 先以「没有更早」落地这一页，再把视口钉成撑满，最后翻出「还有更早」。顺序
  // 反过来，挂载那一刻的填窗判据就先追了一页——20 条短消息在真浏览器里确实撑不
  // 满视口，但那是最后一组用例要问的事，这几条问的是「滚到顶要不要页」。
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({ messages: page("p", 20), hasEarlier: false }),
    );
  });
  pinViewport(400, 4000);
  if (hasEarlier) {
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ messages: page("p", 20), hasEarlier: true }),
      );
    });
  }
  return ctx;
}

describe("上翻取更早", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("滚到接近顶部才要下一页，锚点是当前的第一条", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    expect(earlierRequests(vscode)).toHaveLength(0);

    scrollTo(0);

    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });
    expect(earlierRequests(vscode)[0].before).toBe("p-0");
    expect(earlierRequests(vscode)[0].requestId).toBeTruthy();
  });

  it("没有更早的内容时（hasEarlier=false）滚到顶也不发请求", async () => {
    const { vscode } = mountWithFirstPage(false);
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });

    scrollTo(0);

    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(0);
  });

  it("回包接在前面（不是替换），重复 id 丢弃，hasMore=false 后不再要", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });

    scrollTo(0);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });
    const { requestId } = earlierRequests(vscode)[0];

    act(() => {
      // 故意夹一条已经在列表里的 `p-0`：去重后它不该出现第二次。
      sendHostMessage(
        fixtures.earlierMessages(
          [msg("o-0", "o-0"), msg("o-1", "o-1"), msg("p-0", "p-0")],
          requestId,
          { hasMore: false },
        ),
      );
    });

    await waitFor(() => {
      expect(renderedIds()).toContain("o-0");
    });
    const ids = renderedIds();
    // 接在前面，且原有的那 20 条一条都没少。
    expect(ids.indexOf("o-1")).toBeLessThan(ids.indexOf("p-0"));
    expect(ids.filter((id) => id === "p-0")).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith("p-"))).toHaveLength(20);

    // 到头了：再滚到顶不会自动再要（要由用户重新触发或宿主重发首屏）。
    scrollTo(0);
    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(1);
  });

  it("晚到的旧回包（requestId 不是当前这次）直接丢弃", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    scrollTo(0);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });

    act(() => {
      sendHostMessage(
        fixtures.earlierMessages([msg("stale-0", "stale-0")], "earlier-999", {
          hasMore: false,
        }),
      );
    });

    await act(async () => {});
    expect(renderedIds()).not.toContain("stale-0");
  });

  it("锚点不在转录里时换下一个已知 id 重试，不把这段历史判成到底", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    scrollTo(0);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });

    // 第一次：锚点失效。
    act(() => {
      sendHostMessage(
        fixtures.earlierMessages([], earlierRequests(vscode)[0].requestId, {
          anchorLost: true,
        }),
      );
    });

    // 页面自己换一个更早的「已知 id」重来 —— 不是回一个空页给用户。
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(2);
    });
    expect(earlierRequests(vscode)[1].before).toBe("p-1");

    // 第二次拿到了。
    act(() => {
      sendHostMessage(
        fixtures.earlierMessages(
          [msg("o-0", "o-0")],
          earlierRequests(vscode)[1].requestId,
          {
            hasMore: false,
          },
        ),
      );
    });
    await waitFor(() => {
      expect(renderedIds()).toContain("o-0");
    });
  });

  it("换满次数还锚点失效就停下，不再无限重试", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    scrollTo(0);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });

    // 首屏 20 条，退让上限 3 次：一共 4 个请求（p-0 → p-1 → p-2 → p-3）。
    for (let i = 0; i < 4; i++) {
      await waitFor(() => {
        expect(earlierRequests(vscode).length).toBe(i + 1);
      });
      act(() => {
        sendHostMessage(
          fixtures.earlierMessages([], earlierRequests(vscode)[i].requestId, {
            anchorLost: true,
          }),
        );
      });
    }

    await act(async () => {});
    expect(earlierRequests(vscode).map((r) => r.before)).toEqual([
      "p-0",
      "p-1",
      "p-2",
      "p-3",
    ]);
    // 放弃后不许再发（没有第 5 次）。
    scrollTo(0);
    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(4);
  });
});

/**
 * 填窗（spec ui/message-rendering-system.md「内容不足一屏 ⇒ 继续往前取」）：
 * 内容撑不满视口时用户根本翻不动——下方没东西可看，也就不会再派发 scroll 事件
 * 去要下一页。所以除了「滚到顶」，还要按几何判据自己补页，并且一页接上来撑不满
 * 就接着追，最多追 3 页。jsdom 里几何量恒为 0，所以把容器读数钉成给定值，再用
 * 一次列表变化（对象全换新 ⇒ keys 变）把判据重新跑起来。
 */
describe("填窗：内容撑不满视口时继续往前取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 让填窗判据重跑一次：重发首屏一页，消息对象全换新。 */
  const pokeList = () => {
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ messages: page("p", 20), hasEarlier: true }),
      );
    });
  };

  const replyEarlier = (
    vscode: Parameters<typeof earlierRequests>[0],
    ids: string[],
    hasMore: boolean,
  ) => {
    const requests = earlierRequests(vscode);
    act(() => {
      sendHostMessage(
        fixtures.earlierMessages(
          ids.map((id) => msg(id, id)),
          requests[requests.length - 1].requestId,
          { hasMore },
        ),
      );
    });
  };

  it("撑不满视口就自己再要一页，撑满了就停", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    // 挂载时量不到视口（jsdom 恒 0）：退回条数判据，一页 20 条不算「没内容」。
    expect(earlierRequests(vscode)).toHaveLength(0);

    // 视口 800、内容只有 900：离底 100px，远不到余量。
    pinViewport(800, 900);
    pokeList();
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });
    expect(earlierRequests(vscode)[0].before).toBe("p-0");

    // 这一页接上来之后内容已经远超视口：不再追第二页。
    pinViewport(800, 4000);
    replyEarlier(vscode, ["o-0"], true);
    await waitFor(() => {
      expect(renderedIds()).toContain("o-0");
    });
    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(1);
  });

  it("每页都很短时最多连追 3 页，到顶就停、再变也不追", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    pinViewport(800, 900);
    pokeList();
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });

    // 一页回来仍然撑不满 ⇒ 自己接着追，不用等用户滚（他也滚不动）。
    replyEarlier(vscode, ["o-1"], true);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(2);
    });
    replyEarlier(vscode, ["o-2"], true);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(3);
    });

    // 第 3 页回来：到顶了，不追第 4 页。
    replyEarlier(vscode, ["o-3"], true);
    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(3);

    // 到顶之后列表再变（对象换新）也不追。
    pokeList();
    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(3);
  });

  it("内容足够长（离底还有余量）时一条也不发", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });

    pinViewport(800, 5000);
    pokeList();
    await act(async () => {});
    expect(earlierRequests(vscode)).toHaveLength(0);
  });

  it("用户又往上翻一次，连追的计数归零、允许再追一段", async () => {
    const { vscode } = mountWithFirstPage();
    await waitFor(() => {
      expect(renderedIds()).toContain("p-0");
    });
    pinViewport(800, 900);
    pokeList();
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(1);
    });
    replyEarlier(vscode, ["o-1"], true);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(2);
    });
    replyEarlier(vscode, ["o-2"], true);
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(3);
    });

    // 上翻意图（滚轮往上）：用户明确在要更早的内容，允许下一段连追。
    act(() => {
      fireEvent.wheel(screen.getByTestId("messages-container"), {
        deltaY: -120,
      });
    });
    pokeList();
    await waitFor(() => {
      expect(earlierRequests(vscode)).toHaveLength(4);
    });
  });
});
