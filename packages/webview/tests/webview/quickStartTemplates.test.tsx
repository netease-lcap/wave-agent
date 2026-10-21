import { describe, it, expect, vi } from "vitest";
import React from "react";
import QuickStartTemplates from "../../src/components/QuickStartTemplates";
import { QUICK_START_CATEGORIES } from "../../src/utils/quickStartTemplates";
import { ChatApp } from "../../src/components/ChatApp";
import {
  render,
  screen,
  fireEvent,
  act,
  sendCommand,
  createMockVscode,
} from "./test-utils";

describe("QuickStartTemplates", () => {
  it("renders the 12 categories at level one", () => {
    render(<QuickStartTemplates onApplyTemplate={vi.fn()} />);

    expect(screen.getByTestId("quick-start")).toBeInTheDocument();
    for (const category of QUICK_START_CATEGORIES) {
      expect(
        screen.getByTestId(`quick-start-cat-${category.id}`),
      ).toHaveTextContent(category.label);
    }
    // 一级没有二级件。
    expect(screen.queryByTestId("quick-start-back")).toBeNull();
    expect(screen.queryAllByTestId("quick-start-sub")).toHaveLength(0);
  });

  it("replaces the row with 返回 + the category's templates", () => {
    render(<QuickStartTemplates onApplyTemplate={vi.fn()} />);

    fireEvent.click(screen.getByTestId("quick-start-cat-feature-dev"));

    const back = screen.getByTestId("quick-start-back");
    expect(back).toHaveTextContent("功能开发");
    expect(screen.getAllByTestId("quick-start-sub")).toHaveLength(4);
    expect(screen.getByText("测试驱动开发")).toBeInTheDocument();
    // 一级分类在二级不可见（整行替换，不是叠一块面板）。
    expect(screen.queryByTestId("quick-start-cat-testing")).toBeNull();
  });

  it("returns to level one from the back pill", () => {
    render(<QuickStartTemplates onApplyTemplate={vi.fn()} />);

    fireEvent.click(screen.getByTestId("quick-start-cat-testing"));
    fireEvent.click(screen.getByTestId("quick-start-back"));

    expect(screen.getByTestId("quick-start-cat-testing")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-start-back")).toBeNull();
  });

  it("hands the full template text (placeholder brackets kept) to the caller", () => {
    const onApplyTemplate = vi.fn();
    render(<QuickStartTemplates onApplyTemplate={onApplyTemplate} />);

    fireEvent.click(screen.getByTestId("quick-start-cat-feature-dev"));
    fireEvent.click(screen.getByText("测试驱动开发"));

    expect(onApplyTemplate).toHaveBeenCalledTimes(1);
    const prompt = onApplyTemplate.mock.calls[0][0] as string;
    expect(prompt).toContain("[功能描述]");
    expect(prompt).toContain("编写测试用例");
  });
});

describe("快捷方式区接入输入框", () => {
  it("fills the message input with the chosen template", async () => {
    render(<ChatApp vscode={createMockVscode()} />);
    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        isStreaming: false,
        sessions: [],
        isAuthenticated: true,
        configurationData: {},
        pendingConfirmations: [],
      });
    });

    // 空态才有这个入口。
    expect(screen.getByTestId("welcome-wordmark")).toBeVisible();
    fireEvent.click(screen.getByTestId("quick-start-cat-git"));
    fireEvent.click(screen.getByText("分支管理"));

    const input = document.getElementById("messageInput");
    expect(input).not.toBeNull();
    expect(input?.textContent).toContain("[分支名称]");
  });
});
