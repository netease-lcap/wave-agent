import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

/**
 * 输入卡片底栏的模型选择器（spec ui/model-selection.md「输入卡片底栏切换模型」）：
 * 清单与当前模型由宿主下发（会话一变就重拉），按钮回显当前模型名，点开向上
 * 展开单选列表，能读图的模型带「视觉」标识，选中即发 `setModel` 并在本地回显。
 */
const MODELS = [
  { name: "claude-sonnet-4", supportsVision: true },
  { name: "deepseek-r1", supportsVision: false },
];

async function renderWithSession() {
  const { vscode } = renderChatApp();
  await act(async () => {
    sendCommand("setInitialState", {
      messages: [],
      session: {
        id: "s1",
        sessionType: "main",
        workdir: "/work/a",
        lastActiveAt: Date.now(),
      },
    });
  });
  await waitFor(() => {
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getConfiguredModels" }),
    );
  });
  return vscode;
}

async function replyModels(currentModel = "claude-sonnet-4") {
  await act(async () => {
    sendCommand("configuredModels", { models: MODELS, currentModel });
  });
}

const trigger = () =>
  screen.getByTestId("model-picker-trigger") as HTMLButtonElement;

describe("输入卡片底栏的模型选择器", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("挂载即向宿主拉清单；回包前不出选择器，回包后回显当前模型", async () => {
    const { vscode } = renderChatApp();

    // 底栏要随时显示当前模型：不等用户敲命令，挂载就拉。
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "getConfiguredModels" }),
      );
    });
    // 宿主还没回（或这台机器一个模型都没配）时不留一个点不开的空控件。
    expect(screen.queryByTestId("model-picker-trigger")).toBeNull();

    await replyModels();
    expect(trigger().textContent).toBe("claude-sonnet-4");
  });

  it("点开列表：全部可选模型都在，当前项选中，只有能读图的带「视觉」标识", async () => {
    await renderWithSession();
    await replyModels();

    await act(async () => {
      fireEvent.click(trigger());
    });

    const items = screen.getAllByRole("option");
    expect(items.map((el) => el.getAttribute("data-value"))).toEqual([
      "claude-sonnet-4",
      "deepseek-r1",
    ]);
    expect(
      screen.getByTestId("model-picker-item-claude-sonnet-4").textContent,
    ).toContain("视觉");
    expect(
      screen.getByTestId("model-picker-item-deepseek-r1").textContent,
    ).not.toContain("视觉");
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    expect(items[1].getAttribute("aria-selected")).toBe("false");
  });

  it("选中另一个模型：发 setModel 并立即回显新名字", async () => {
    const vscode = await renderWithSession();
    await replyModels();
    vscode.postMessage.mockClear();

    await act(async () => {
      fireEvent.click(trigger());
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("model-picker-item-deepseek-r1"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "setModel",
      model: "deepseek-r1",
    });
    expect(trigger().textContent).toBe("deepseek-r1");
    expect(screen.queryByTestId("model-picker-menu")).toBeNull();
  });

  it("点当前模型不重复写配置", async () => {
    const vscode = await renderWithSession();
    await replyModels();
    vscode.postMessage.mockClear();

    await act(async () => {
      fireEvent.click(trigger());
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("model-picker-item-claude-sonnet-4"));
    });

    expect(
      vscode.postMessage.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((m) => m.command === "setModel"),
    ).toEqual([]);
    expect(screen.queryByTestId("model-picker-menu")).toBeNull();
  });

  it("键盘：焦点落在当前项，↑↓ 移动，Enter 选中，Esc 关闭不改", async () => {
    const vscode = await renderWithSession();
    await replyModels();
    vscode.postMessage.mockClear();

    await act(async () => {
      fireEvent.click(trigger());
    });
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(".model-picker-item"),
    );
    await waitFor(() => {
      expect(items[0]).toBe(document.activeElement);
    });

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toBe(document.activeElement);

    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(screen.queryByTestId("model-picker-menu")).toBeNull();
    expect(trigger()).toBe(document.activeElement);
    expect(
      vscode.postMessage.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((m) => m.command === "setModel"),
    ).toEqual([]);

    await act(async () => {
      fireEvent.click(trigger());
    });
    const again = document.querySelectorAll<HTMLElement>(".model-picker-item");
    fireEvent.keyDown(again[0], { key: "ArrowDown" });
    fireEvent.keyDown(again[1], { key: "Enter" });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "setModel",
      model: "deepseek-r1",
    });
  });

  it("切换会话时重拉清单（每个会话的模型可能不同）", async () => {
    const vscode = await renderWithSession();
    await replyModels();
    vscode.postMessage.mockClear();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        session: {
          id: "s2",
          sessionType: "main",
          workdir: "/work/b",
          lastActiveAt: Date.now(),
        },
      });
    });

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "getConfiguredModels" }),
      );
    });

    await replyModels("deepseek-r1");
    expect(trigger().textContent).toBe("deepseek-r1");
  });
});
