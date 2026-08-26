import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastStack } from "../../src/components/ToastStack";
import type { UpdateToast } from "../../src/types";

const toast = (overrides: Partial<UpdateToast> = {}): UpdateToast => ({
  id: "t1",
  message: "新版本 v0.20.0 已下载完成",
  ...overrides,
});

describe("ToastStack", () => {
  afterEach(() => {
    vi.useRealTimers();
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
        toasts={[
          toast({
            actionLabel: "重启安装",
            action: { type: "quitAndInstall" },
          }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("新版本 v0.20.0 已下载完成")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重启安装" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("omits the action button when the toast has no action", () => {
    render(
      <ToastStack toasts={[toast()]} onDismiss={vi.fn()} onAction={vi.fn()} />,
    );
    expect(screen.getByText("新版本 v0.20.0 已下载完成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重启安装" })).toBeNull();
  });

  it("renders a loading state (spinner, no action button) while the action is in flight", () => {
    render(
      <ToastStack
        toasts={[
          toast({
            loading: true,
            message: "正在重启应用以完成安装…",
            actionLabel: "重启安装",
            action: { type: "quitAndInstall" },
          }),
        ]}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("正在重启应用以完成安装…")).toBeInTheDocument();
    expect(document.querySelector(".toast-spinner")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "重启安装" })).toBeNull();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("does not auto-dismiss a loading toast (the action is still in flight)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[
          toast({
            loading: true,
            actionLabel: "重启安装",
            action: { type: "quitAndInstall" },
          }),
        ]}
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
    vi.advanceTimersByTime(7999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("does not auto-dismiss a toast with an action (waits for the user)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[
          toast({
            actionLabel: "重启安装",
            action: { type: "quitAndInstall" },
          }),
        ]}
        onDismiss={onDismiss}
        onAction={vi.fn()}
      />,
    );
    vi.advanceTimersByTime(60000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("fires onAction with the whole toast when the action button is clicked", () => {
    const onAction = vi.fn();
    const item = toast({
      actionLabel: "重启安装",
      action: { type: "quitAndInstall" },
    });
    render(
      <ToastStack toasts={[item]} onDismiss={vi.fn()} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重启安装" }));
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
