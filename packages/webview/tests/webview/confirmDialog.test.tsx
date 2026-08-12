import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title, description and both buttons", () => {
    render(
      <ConfirmDialog
        title="确定要回滚到此消息吗？"
        description="这将删除之后的所有消息并撤销相关的文件更改。"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("确定要回滚到此消息吗？")).toBeInTheDocument();
    expect(
      screen.getByText("这将删除之后的所有消息并撤销相关的文件更改。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-cancel")).toHaveTextContent(
      "取消",
    );
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
      "确定",
    );
  });

  it("omits the description when not provided", () => {
    const { container } = render(
      <ConfirmDialog title="t" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector(".confirm-dialog-description")).toBeNull();
  });

  it("supports custom button text", () => {
    render(
      <ConfirmDialog
        title="t"
        confirmText="删除"
        cancelText="再想想"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
      "删除",
    );
    expect(screen.getByTestId("confirm-dialog-cancel")).toHaveTextContent(
      "再想想",
    );
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="t" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="t" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="t" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms on Enter when no button is focused", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="t" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    // Blur the auto-focused confirm button so the window-level handler fires.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("lets the focused button handle Enter (no double-fire)", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="t" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    // Confirm button is auto-focused; keyDown targeted at the window with a
    // focused button must be ignored by the dialog's own handler.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does NOT dismiss when the scrim (overlay) is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="t" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId("confirm-dialog-overlay"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
