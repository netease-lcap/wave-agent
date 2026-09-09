import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsList } from "../../src/utils/useSettingsList";

const dispatch = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
};

describe("useSettingsList", () => {
  it("fetches on mount, writes picked items and clears loading on response", () => {
    const fetchRequest = vi.fn();
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest,
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
      }),
    );
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    dispatch({ command: "listResponse", items: ["a", "b"] });
    expect(result.current.items).toEqual(["a", "b"]);
    expect(result.current.loading).toBe(false);
  });

  it("ignores commands outside responseCommands", () => {
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest: () => {},
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
      }),
    );
    dispatch({ command: "otherResponse", items: ["x"] });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it("re-fetches and re-enters loading when fetchKey changes", () => {
    const fetchRequest = vi.fn();
    const { result, rerender } = renderHook(
      ({ fetchKey }: { fetchKey: string }) =>
        useSettingsList<string[], string>({
          initialItems: [],
          fetchRequest,
          fetchKey,
          responseCommands: ["listResponse"],
          pickItems: (message) => message.items || [],
        }),
      { initialProps: { fetchKey: "user" } },
    );
    dispatch({ command: "listResponse", items: ["a"] });
    expect(result.current.loading).toBe(false);
    rerender({ fetchKey: "project" });
    expect(result.current.loading).toBe(true);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    dispatch({ command: "listResponse", items: ["b"] });
    expect(result.current.items).toEqual(["b"]);
    expect(result.current.loading).toBe(false);
  });

  it("attributionKey mismatch drops the stale reply (过期即弃，hooksResponse→scope)", () => {
    const fetchRequest = vi.fn();
    const { result } = renderHook(
      ({ fetchKey }: { fetchKey: string }) =>
        useSettingsList<string[], string>({
          initialItems: [],
          fetchRequest,
          fetchKey,
          responseCommands: ["listResponse"],
          pickItems: (message) => message.items || [],
          attributionKey: (message) => message.scope as string,
        }),
      { initialProps: { fetchKey: "project" } },
    );
    // 切 Tab 前发出的 user 慢回复：归属不符 → 丢弃，loading 保持（当前拉取在途）
    dispatch({ command: "listResponse", scope: "user", items: ["stale"] });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
    // 归属相符的回复正常生效
    dispatch({ command: "listResponse", scope: "project", items: ["fresh"] });
    expect(result.current.items).toEqual(["fresh"]);
    expect(result.current.loading).toBe(false);
  });

  it("attributionKey without fetchKey does not filter (挂载拉取一次的视图)", () => {
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest: () => {},
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
        attributionKey: (message) => message.scope as string,
      }),
    );
    dispatch({ command: "listResponse", scope: "user", items: ["a"] });
    expect(result.current.items).toEqual(["a"]);
    expect(result.current.loading).toBe(false);
  });

  it("calls onResponse with the matched message for view-specific state", () => {
    let extra: string | null = null;
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest: () => {},
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
        onResponse: (message) => {
          extra = message.configPath ?? null;
        },
      }),
    );
    dispatch({
      command: "listResponse",
      items: [],
      configPath: "/p/settings.json",
    });
    expect(result.current.loading).toBe(false);
    expect(extra).toBe("/p/settings.json");
  });

  it("confirmDelete passes the pending item to send and closes the dialog", () => {
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest: () => {},
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
      }),
    );
    act(() => result.current.setPendingDelete("a"));
    const send = vi.fn();
    act(() => result.current.confirmDelete(send));
    expect(send).toHaveBeenCalledWith("a");
    expect(result.current.pendingDelete).toBeNull();
  });

  it("confirmDelete without a pending item never calls send", () => {
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest: () => {},
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
      }),
    );
    const send = vi.fn();
    act(() => result.current.confirmDelete(send));
    expect(send).not.toHaveBeenCalled();
  });

  it("cancelDelete closes the dialog without calling send", () => {
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest: () => {},
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
      }),
    );
    act(() => result.current.setPendingDelete("a"));
    const send = vi.fn();
    act(() => result.current.cancelDelete());
    expect(result.current.pendingDelete).toBeNull();
    act(() => result.current.confirmDelete(send));
    expect(send).not.toHaveBeenCalled();
  });

  it("refresh re-sends the latest fetchRequest without toggling loading", () => {
    const fetchRequest = vi.fn();
    const { result } = renderHook(() =>
      useSettingsList<string[], string>({
        initialItems: [],
        fetchRequest,
        responseCommands: ["listResponse"],
        pickItems: (message) => message.items || [],
      }),
    );
    dispatch({ command: "listResponse", items: ["a"] });
    expect(result.current.loading).toBe(false);
    act(() => result.current.refresh());
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
  });
});
