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
 * jsdom 不排版，scrollTop/clientHeight/scrollHeight 全是 0。把几何量塞进容器再
 * 派发一次 scroll，let 滚动处理器看到我们想让它看到的位置。
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

/** 首屏：一页 20 条，并告诉页面「更早的还有」。 */
function mountWithFirstPage(hasEarlier = true) {
  const ctx = renderChatApp();
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({
        messages: page("p", 20),
        hasEarlier,
      }),
    );
  });
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
