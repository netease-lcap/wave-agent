import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHostMessage } from "../../src/utils/useHostMessage";

const dispatch = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
};

describe("useHostMessage", () => {
  it("dispatches host messages (event.data) to the handler", () => {
    const handler = vi.fn();
    renderHook(() => useHostMessage(handler));
    dispatch({ command: "statusResponse", version: "1.0" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      command: "statusResponse",
      version: "1.0",
    });
  });

  it("always invokes the latest handler after re-renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: (message: unknown) => void }) =>
        useHostMessage(handler),
      { initialProps: { handler: first } },
    );
    rerender({ handler: second });
    dispatch({ command: "ping" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("paneId set: drops untagged and sibling-tagged messages, keeps own tag", () => {
    const handler = vi.fn();
    renderHook(() => useHostMessage(handler, { paneId: "pane-a" }));
    // 未打标签 → 丢弃（pane 实例只收自己的标签）
    dispatch({ command: "desktopWorkspaceDiff" });
    // 兄弟 pane 的标签 → 丢弃
    dispatch({ command: "desktopWorkspaceDiff", paneId: "pane-b" });
    expect(handler).not.toHaveBeenCalled();
    // 自己的标签 → 放行
    dispatch({ command: "desktopWorkspaceDiff", paneId: "pane-a" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("paneId undefined: passes everything through unfiltered", () => {
    const handler = vi.fn();
    renderHook(() => useHostMessage(handler));
    dispatch({ command: "desktopWorkspaceDiff" });
    dispatch({ command: "desktopWorkspaceDiff", paneId: "pane-b" });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("enabled=false ignores events until enabled again", () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useHostMessage(handler, { enabled }),
      { initialProps: { enabled: false } },
    );
    dispatch({ command: "ping" });
    expect(handler).not.toHaveBeenCalled();
    rerender({ enabled: true });
    dispatch({ command: "ping" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHostMessage(handler));
    unmount();
    dispatch({ command: "ping" });
    expect(handler).not.toHaveBeenCalled();
  });
});
