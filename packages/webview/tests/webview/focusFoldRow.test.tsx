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

  it("运行中的一轮说「正在执行 X…」并带已跑次数", () => {
    renderRow(foldItem({ live: true, callCount: 2, runningToolName: "Bash" }));
    const text = screen.getByTestId("focus-fold").textContent ?? "";
    expect(text).toContain("正在执行 Bash…");
    expect(text).toContain("已 2 次");
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
