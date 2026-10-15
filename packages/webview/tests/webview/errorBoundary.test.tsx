import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

/** 渲染期抛错的组件 —— React 18 遇到这种错才卸载整棵树。 */
function Boom(): React.ReactElement {
  throw new Error("undefined is not an object (evaluating 'e.slice')");
}

// 本文件的每个用例都在故意造渲染期错误：React 开发版把它们经 window 的 error
// 事件交回运行时，jsdom 见没人认领就转手打到进程 stderr —— 几十行堆栈全是测试
// 自己的噪音。在 window 上认领一下（`preventDefault` 即表示已处理），jsdom 就
// 不再上报。
const swallowWindowError = (event: ErrorEvent) => event.preventDefault();

describe("ErrorBoundary", () => {
  beforeAll(() => {
    window.addEventListener("error", swallowWindowError);
  });

  afterAll(() => {
    window.removeEventListener("error", swallowWindowError);
  });

  it("passes children through while nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>正常的页面</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("正常的页面")).toBeInTheDocument();
    expect(screen.queryByTestId("app-error-boundary")).not.toBeInTheDocument();
  });

  it("shows a way out instead of leaving the page blank", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    // 没有边界时这三条都拿不到东西：React 把根容器清空，页面上只剩一片白。
    expect(screen.getByTestId("app-error-boundary")).toBeInTheDocument();
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
  });

  it("keeps the failure text, the only thing a phone can report", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("app-error-boundary")).toHaveTextContent(
      "undefined is not an object",
    );
  });

  it("reloads the page when the way out is taken", () => {
    const reload = vi.fn();
    const original = window.location;
    // jsdom 的 location 是不可替换的宿主对象，这里换成一个只带 reload 的壳。
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload },
    });
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });
});
