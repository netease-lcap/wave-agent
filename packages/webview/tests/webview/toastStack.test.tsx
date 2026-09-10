import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastStack } from "../../src/components/ToastStack";
import type { UpdateToast } from "../../src/types";

const toast = (overrides: Partial<UpdateToast> = {}): UpdateToast => ({
  id: "t1",
  message: "发现新版本 v0.20.0",
  ...overrides,
});

/** 后台会话确认 toast 的真实形状（宿主显式声明 position: "bottomRight"）。 */
const sessionAction = {
  actionLabel: "查看",
  action: { type: "focusSession" as const, host: "local", sessionId: "s2" },
};

describe("ToastStack", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders nothing when empty", () => {
    const { container } = render(
      <ToastStack toasts={[]} onDismiss={vi.fn()} onAction={vi.fn()} />,
    );
    expect(container.querySelector(".toast-stack")).toBeNull();
  });

  it("renders the message with an action button and a close button", () => {
    render(
      <ToastStack
        toasts={[toast(sessionAction)]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("发现新版本 v0.20.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("omits the action button when the toast has no action", () => {
    render(
      <ToastStack toasts={[toast()]} onDismiss={vi.fn()} onAction={vi.fn()} />,
    );
    expect(screen.getByText("发现新版本 v0.20.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
  });

  it("renders a loading state (spinner, no action button) while the action is in flight", () => {
    render(
      <ToastStack
        toasts={[
          toast({
            loading: true,
            message: "正在切换到会话…",
            ...sessionAction,
          }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("正在切换到会话…")).toBeInTheDocument();
    expect(document.querySelector(".toast-spinner")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("does not auto-dismiss a loading toast (the action is still in flight)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[toast({ loading: true, ...sessionAction })]}
        onDismiss={onDismiss}
        onAction={vi.fn()}
      />,
    );
    vi.advanceTimersByTime(60000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("stacks multiple toasts vertically", () => {
    render(
      <ToastStack
        toasts={[
          toast({ id: "t1" }),
          toast({ id: "t2", message: "当前已是最新版本" }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("toast")).toHaveLength(2);
    expect(screen.getByText("当前已是最新版本")).toBeInTheDocument();
  });

  it("auto-dismisses a button-less toast after the timeout", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[toast()]}
        onDismiss={onDismiss}
        onAction={vi.fn()}
      />,
    );
    // 信息类 toast 1s 自动消失（spec 场景 7）；带 action 的常驻（下一用例）
    vi.advanceTimersByTime(999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("does not auto-dismiss a toast with an action (waits for the user)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[toast(sessionAction)]}
        onDismiss={onDismiss}
        onAction={vi.fn()}
      />,
    );
    vi.advanceTimersByTime(60000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("fires onAction with the whole toast when the action button is clicked", () => {
    const onAction = vi.fn();
    const item = toast(sessionAction);
    render(
      <ToastStack toasts={[item]} onDismiss={vi.fn()} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(onAction).toHaveBeenCalledWith(item);
  });

  it("dismisses by id when the close button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[toast()]}
        onDismiss={onDismiss}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });
});

// 2026-09-10 拍板：toast 按宿主显式声明的 position 分两个栈渲染——应用级全局提示
// 顶部居中（新形态），后台会话确认提示右下角（保持改动前 VS Code 通知形态）。
describe("ToastStack position split", () => {
  it("renders app-level toasts in the top stack (position 缺省 = top)", () => {
    render(
      <ToastStack
        toasts={[toast({ id: "app", message: "保存成功", type: "success" })]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const top = screen.getByTestId("toast-stack--top");
    expect(top).toContainElement(screen.getByTestId("toast"));
    expect(top.querySelector(".toast--top")).not.toBeNull();
    expect(screen.queryByTestId("toast-stack--bottomRight")).toBeNull();
  });

  it("renders session toasts in the bottom-right stack, isolated from the top stack", () => {
    render(
      <ToastStack
        toasts={[
          toast({
            id: "s",
            message: "会话「A」需要确认",
            ...sessionAction,
            position: "bottomRight",
          }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const bottom = screen.getByTestId("toast-stack--bottomRight");
    expect(bottom).toContainElement(screen.getByTestId("toast"));
    expect(bottom.querySelector(".toast--bottomRight")).not.toBeNull();
    expect(screen.queryByTestId("toast-stack--top")).toBeNull();
  });

  it("keeps both stacks coexisting in their own containers (互不干扰)", () => {
    render(
      <ToastStack
        toasts={[
          toast({ id: "app", message: "保存成功", type: "success" }),
          toast({
            id: "s",
            message: "会话「A」需要确认",
            ...sessionAction,
            position: "bottomRight",
          }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const top = screen.getByTestId("toast-stack--top");
    const bottom = screen.getByTestId("toast-stack--bottomRight");
    // 两条 toast 各归各栈，互不掺入对方容器
    expect(top.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    expect(bottom.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    expect(top).toHaveTextContent("保存成功");
    expect(top).not.toHaveTextContent("需要确认");
    expect(bottom).toHaveTextContent("会话「A」需要确认");
    // 语义图标只出现在顶部（app 级）栈，右下角栈保持旧形态（无 kind 图标）
    expect(top.querySelector(".toast-kind-icon")).not.toBeNull();
    expect(bottom.querySelector(".toast-kind-icon")).toBeNull();
  });

  it("anchors only the top stack to the anchor container centre", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const anchor = document.createElement("div");
    anchor.className = "anchor-target";
    document.body.appendChild(anchor);
    try {
      render(
        <ToastStack
          toasts={[
            toast({ id: "app", message: "保存成功" }),
            toast({
              id: "s",
              message: "会话「A」需要确认",
              ...sessionAction,
              position: "bottomRight",
            }),
          ]}
          onDismiss={vi.fn()}
          onAction={vi.fn()}
          anchorSelector=".anchor-target"
        />,
      );
      expect(screen.getByTestId("toast-stack--top").style.left).not.toBe("");
      // 右下角栈不吃锚点（固定右下，由 base CSS 定位）
      expect(screen.getByTestId("toast-stack--bottomRight").style.left).toBe(
        "",
      );
    } finally {
      anchor.remove();
    }
  });
});

// 2026-09-10 拍板：语义三色只给设置页结果型提示；无 type = 中性（默认底色 +
// 无语义图标），不得回退为 info 蓝。
describe("ToastStack semantic colour scope", () => {
  it("renders an untyped app toast with no semantic class and no kind icon", () => {
    render(
      <ToastStack
        toasts={[toast({ message: "连接主机失败" })]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const row = screen.getByTestId("toast");
    expect(row.className).toBe("toast toast--top");
    expect(row.querySelector(".toast-kind-icon")).toBeNull();
  });

  it.each([
    ["success", "toast toast--top toast--success"],
    ["error", "toast toast--top toast--error"],
    ["info", "toast toast--top toast--info"],
  ] as const)(
    "renders a %s app toast with its semantic class and icon",
    (type, className) => {
      render(
        <ToastStack
          toasts={[toast({ message: "保存成功", type })]}
          onDismiss={vi.fn()}
          onAction={vi.fn()}
        />,
      );
      const row = screen.getByTestId("toast");
      expect(row.className).toBe(className);
      expect(row.querySelector(".toast-kind-icon")).not.toBeNull();
    },
  );

  it("does not colour or icon a session toast even when it carries a type", () => {
    render(
      <ToastStack
        toasts={[
          toast({ ...sessionAction, type: "error", position: "bottomRight" }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const row = screen.getByTestId("toast");
    expect(row.className).toBe("toast toast--bottomRight");
    expect(row.querySelector(".toast-kind-icon")).toBeNull();
  });
});
