import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FocusFoldRow } from "../../src/components/FocusFoldRow";
import type { FocusFoldItem } from "../../src/utils/focusItems";
import { MockDataGenerator } from "../fixtures/mockData";

function foldItem(overrides: Partial<FocusFoldItem> = {}): FocusFoldItem {
  return {
    kind: "fold",
    key: "focus-fold:a1:a2",
    messages: [
      MockDataGenerator.createAssistantMessage("先读文件", "a1"),
      MockDataGenerator.createAssistantMessage("再改文件", "a2"),
    ],
    startMessageIndex: 1,
    endMessageIndex: 2,
    callCount: 3,
    errorCount: 0,
    hasReasoning: false,
    live: false,
    ...overrides,
  };
}

const renderRow = (item: FocusFoldItem, expanded = false, onToggle = vi.fn()) =>
  render(
    <FocusFoldRow
      item={item}
      expanded={expanded}
      onToggle={onToggle}
      renderMessage={(message) => <div key={message.id}>{message.id}</div>}
    />,
  );

describe("FocusFoldRow", () => {
  it("收起时只有卡头，不渲染卡内消息", () => {
    renderRow(foldItem());

    expect(screen.getByTestId("focus-fold-head")).toBeTruthy();
    expect(screen.queryByTestId("focus-fold-body")).toBeNull();
    expect(
      screen.getByTestId("focus-fold-head").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("点卡头把展开动作交给宿主", () => {
    const onToggle = vi.fn();
    renderRow(foldItem(), false, onToggle);

    fireEvent.click(screen.getByTestId("focus-fold-head"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("折叠图标与思考块 / 压缩块同一颗（内联 svg，展开态打 expanded）", () => {
    // 三处折叠入口共用 QueueChevronIcon：不是字体图标里的 codicon，也不是
    // CSS 画的三角。这里只锚「svg 存在 + 状态类」，不锚路径数据。
    const closed = renderRow(foldItem());
    const closedIcon = screen
      .getByTestId("focus-fold-head")
      .querySelector("svg.focus-fold-chevron");
    expect(closedIcon).not.toBeNull();
    expect(closedIcon?.getAttribute("class")).not.toContain("expanded");
    closed.unmount();

    renderRow(foldItem(), true);
    const openIcon = screen
      .getByTestId("focus-fold-head")
      .querySelector("svg.focus-fold-chevron");
    expect(openIcon?.getAttribute("class")).toContain("expanded");
  });

  it("折叠图标排在文案之后（与 CC 桌面端同侧，不做行尾对齐）", () => {
    // CC 桌面端的折叠箭头是内容之后的一个独立 shrink-0 小按钮，不推到行尾
    // （desktop 6.28899.6 的 shared-9-BGHwpAny.js：mF / gF）。我们照同一侧
    // 摆：卡头的最后一个元素就是那颗图标，文案变宽时它会跟着挪，不为它另加
    // 钉死规则。
    renderRow(foldItem({ live: true, runningToolName: "WebFetch" }));
    const head = screen.getByTestId("focus-fold-head");

    expect(head.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(head.lastElementChild?.getAttribute("class")).toContain(
      "focus-fold-chevron",
    );
    // 卡头不带时间线节点（2026-11-27 定档）：第一个元素就是文案，点与线只在
    // 展开卡内的真实活动上。
    expect(head.firstElementChild?.getAttribute("class")).toContain(
      "focus-fold-label",
    );
    expect(head.querySelector(".focus-fold-dot")).toBeNull();
  });

  it("卡头左内衬归零、右侧留 8px（插件档也不为圆点留位）", () => {
    // base 的 padding-left 只要留 8px，没有 `data-host="desktop"` 覆盖的那几端
    // （插件端 / 远控页）卡头文案就比卡外答复正文右移 8px。右侧那 8px 是给
    // 整行按钮留的边，别一起归零。
    renderRow(foldItem());
    const style = getComputedStyle(screen.getByTestId("focus-fold-head"));
    expect(style.paddingLeft).toBe("0px");
    expect(style.paddingRight).toBe("8px");
  });

  it("进行态扫光是 aria-hidden 的视觉替身：读屏只读一遍摘要", () => {
    // `::after { content: attr(data-label) }` 会在按钮里再生成一份同样的文案，
    // 而伪元素的内容计入 accessible name —— 读屏会把摘要读两遍。换成真实元素
    // 后靠 `aria-hidden` 把它挡在可访问性树外，按钮名仍是那一份文案。
    renderRow(foldItem({ live: true, runningToolName: "Bash" }));
    const head = screen.getByTestId("focus-fold-head");
    expect(screen.getByRole("button", { name: "正在执行 Bash…" })).toBe(head);

    const sweep = head.querySelector(".focus-fold-sweep");
    expect(sweep).not.toBeNull();
    expect(sweep?.getAttribute("aria-hidden")).toBe("true");
    expect(sweep?.textContent).toBe("正在执行 Bash…");
  });

  it("结算后不再有扫光节点（只挂进行态）", () => {
    renderRow(foldItem({ callCount: 3 }));
    const head = screen.getByTestId("focus-fold-head");
    expect(head.querySelector(".focus-fold-sweep")).toBeNull();
    expect(screen.getByRole("button", { name: "3 次工具调用" })).toBe(head);
  });

  it("展开后把这一轮的消息交给 renderMessage 渲染", () => {
    renderRow(foldItem(), true);

    const body = screen.getByTestId("focus-fold-body");
    expect(body.textContent).toBe("a1a2");
    expect(
      screen.getByTestId("focus-fold-head").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("落定的一轮按工具调用次数出文案", () => {
    renderRow(foldItem({ callCount: 3 }));
    expect(screen.getByTestId("focus-fold").textContent).toContain(
      "3 次工具调用",
    );
  });

  it("有失败时卡头右侧补失败数", () => {
    renderRow(foldItem({ callCount: 3, errorCount: 2 }));
    expect(screen.getByTestId("focus-fold").textContent).toContain("2 个失败");
  });

  it("运行中的一轮说「正在执行 X…」，行尾不出计数", () => {
    renderRow(foldItem({ live: true, callCount: 2, runningToolName: "Bash" }));
    const text = screen.getByTestId("focus-fold").textContent ?? "";
    expect(text).toContain("正在执行 Bash…");
    expect(text).not.toContain("2 次");
  });

  it("进行态不显示失败计数（轮内数字一直涨，文案会跟着跳）", () => {
    renderRow(
      foldItem({
        live: true,
        callCount: 3,
        errorCount: 2,
        runningToolName: "Bash",
      }),
    );
    const text = screen.getByTestId("focus-fold").textContent ?? "";
    expect(text).not.toContain("个失败");
  });

  it("运行中但没有在跑的工具时退成「正在思考…」", () => {
    renderRow(foldItem({ live: true, callCount: 1, hasReasoning: true }));
    expect(screen.getByTestId("focus-fold").textContent).toContain("正在思考…");
  });

  it("没有任何工具与思考的一轮退成「过程」", () => {
    renderRow(foldItem({ live: false, callCount: 0, hasReasoning: false }));
    expect(screen.getByTestId("focus-fold").textContent).toContain("过程");
  });
});
