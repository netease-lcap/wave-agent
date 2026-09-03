import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useClickOutside } from "../../src/utils/useClickOutside";

/** 等待 useClickOutside 内部的 setTimeout(0) 延迟注册完成。 */
async function flushDeferredRegistration() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function ClickOutsideHarness({
  enabled = true,
  onOutside,
  refs = [],
}: {
  enabled?: boolean;
  onOutside: () => void;
  /** 额外的豁免节点（含 trigger 场景）。 */
  refs?: Array<React.RefObject<HTMLElement | null>>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const allRefs = [panelRef, ...refs];
  useClickOutside({
    refs: allRefs,
    enabled,
    onClickOutside: onOutside,
  });
  return (
    <div>
      <div ref={panelRef} data-testid="panel">
        panel
      </div>
      <div data-testid="outside">outside</div>
    </div>
  );
}

describe("useClickOutside", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("注册延迟一帧：弹层挂载当次的同帧外部 mousedown 不触发", async () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(
      <ClickOutsideHarness onOutside={onOutside} />,
    );

    // 弹层刚挂载、setTimeout(0) 尚未执行 —— 模拟"挂载当次的打开点击"
    // 仍在冒泡：listener 还未注册，不能被误触发。
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();

    await flushDeferredRegistration();
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("注册完成后点击外部触发", async () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(
      <ClickOutsideHarness onOutside={onOutside} />,
    );
    await flushDeferredRegistration();

    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("点击弹层内部不触发", async () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(
      <ClickOutsideHarness onOutside={onOutside} />,
    );
    await flushDeferredRegistration();

    fireEvent.mouseDown(getByTestId("panel"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("额外豁免节点（trigger）内点击不触发", async () => {
    const onOutside = vi.fn();
    function HarnessWithTrigger() {
      const panelRef = useRef<HTMLDivElement>(null);
      const triggerRef = useRef<HTMLDivElement>(null);
      useClickOutside({
        refs: [panelRef, triggerRef],
        onClickOutside: onOutside,
      });
      return (
        <div>
          <div ref={panelRef} data-testid="panel">
            panel
          </div>
          <div ref={triggerRef} data-testid="trigger">
            trigger
          </div>
          <div data-testid="outside">outside</div>
        </div>
      );
    }
    const { getByTestId } = render(<HarnessWithTrigger />);
    await flushDeferredRegistration();

    fireEvent.mouseDown(getByTestId("trigger"));
    expect(onOutside).not.toHaveBeenCalled();

    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 时不注册监听", async () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(
      <ClickOutsideHarness onOutside={onOutside} enabled={false} />,
    );
    await flushDeferredRegistration();

    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("enabled 从 false 变 true 后开始监听", async () => {
    const onOutside = vi.fn();
    const { getByTestId, rerender } = render(
      <ClickOutsideHarness onOutside={onOutside} enabled={false} />,
    );
    await flushDeferredRegistration();
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();

    rerender(<ClickOutsideHarness onOutside={onOutside} enabled={true} />);
    await flushDeferredRegistration();
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("卸载后移除监听，不再触发", async () => {
    const onOutside = vi.fn();
    const { getByTestId, unmount } = render(
      <ClickOutsideHarness onOutside={onOutside} />,
    );
    await flushDeferredRegistration();

    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);

    unmount();
    // 卸载后组件与节点已从 body 移除；对 document.body 派发 mousedown，
    // 若监听器未清理仍会冒泡到 document 触发。
    fireEvent.mouseDown(document.body);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });
});
