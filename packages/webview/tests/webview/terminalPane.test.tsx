import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { TerminalPane } from "../../src/components/TerminalPane";
import { createMockVscode, sendCommand } from "./test-utils";

class MockTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown>;
  written: string[] = [];
  resetCount = 0;
  disposed = false;
  addons: unknown[] = [];
  private dataCb: ((data: string) => void) | null = null;
  constructor(options: Record<string, unknown>) {
    this.options = options;
    mockTerminals.push(this);
  }
  loadAddon(addon: unknown) {
    this.addons.push(addon);
  }
  open() {}
  focus = vi.fn();
  onData(cb: (data: string) => void) {
    this.dataCb = cb;
  }
  write(data: string) {
    this.written.push(data);
  }
  reset() {
    this.resetCount++;
  }
  dispose() {
    this.disposed = true;
  }
  simulateInput(data: string) {
    this.dataCb?.(data);
  }
}

/** Mirrors @xterm/addon-web-links: ctor captures the click handler. */
class MockWebLinksAddon {
  handler: ((event: MouseEvent, uri: string) => void) | null;
  constructor(handler?: (event: MouseEvent, uri: string) => void) {
    this.handler = handler ?? null;
  }
  activate() {}
  dispose() {}
}

const mockTerminals: MockTerminal[] = [];

function renderPane(options?: {
  paneId?: string;
  visible?: boolean;
  sessionId?: string;
  workdir?: string;
  onClose?: () => void;
  onOpenPreview?: (url: string) => void;
}) {
  const vscode = createMockVscode();
  const onClose = options?.onClose ?? vi.fn();
  const onOpenPreview = options?.onOpenPreview ?? vi.fn();
  const result = render(
    <TerminalPane
      vscode={vscode}
      width={420}
      onWidthChange={vi.fn()}
      maxWidth={716}
      onClose={onClose}
      paneId={options?.paneId}
      visible={options?.visible ?? true}
      sessionId={options?.sessionId}
      workdir={options?.workdir}
      onOpenPreview={onOpenPreview}
    />,
  );
  const rerenderWith = (props: {
    visible?: boolean;
    sessionId?: string;
    workdir?: string;
  }) =>
    result.rerender(
      <TerminalPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={onClose}
        paneId={options?.paneId}
        visible={props.visible ?? true}
        sessionId={props.sessionId}
        workdir={props.workdir}
        onOpenPreview={onOpenPreview}
      />,
    );
  return { ...result, rerenderWith, vscode, onClose, onOpenPreview };
}

const postsOf = (
  vscode: ReturnType<typeof createMockVscode>,
  command: string,
) =>
  vscode.postMessage.mock.calls
    .filter(([msg]) => msg.command === command)
    .map(([msg]) => msg);

beforeEach(() => {
  mockTerminals.length = 0;
  window.WaveTerminal = {
    Terminal: MockTerminal,
    FitAddon: class {
      fit = vi.fn();
    },
    WebLinksAddon: MockWebLinksAddon as unknown as NonNullable<
      Window["WaveTerminal"]
    >["WebLinksAddon"],
  } as unknown as NonNullable<Window["WaveTerminal"]>;
});

afterEach(() => {
  delete window.WaveTerminal;
});

describe("TerminalPane", () => {
  it("builds the xterm terminal and creates the PTY on mount", async () => {
    const { vscode } = renderPane({ paneId: "pane-1" });
    await act(async () => {});
    expect(mockTerminals).toHaveLength(1);
    expect(postsOf(vscode, "desktopTerminalCreate")).toEqual([
      {
        command: "desktopTerminalCreate",
        termId: "term-pane-1",
        paneId: "pane-1",
        cols: 80,
        rows: 24,
      },
    ]);
  });

  it("uses term-main when no paneId is given", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")[0]).toMatchObject({
      termId: "term-main",
    });
  });

  it("hidden mount keeps the PTY unstarted; re-show creates it", async () => {
    const { vscode, rerenderWith } = renderPane({ visible: false });
    await act(async () => {});
    expect(mockTerminals).toHaveLength(1); // xterm built, PTY not started
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(0);
    rerenderWith({ visible: true });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
  });

  it("focuses the terminal on first open (visible mount after chunk load)", async () => {
    renderPane();
    await act(async () => {});
    expect(mockTerminals[0].focus).toHaveBeenCalledTimes(1);
  });

  it("focuses the terminal when the panel becomes visible, not on hidden mount", async () => {
    const { rerenderWith } = renderPane({ visible: false });
    await act(async () => {});
    expect(mockTerminals[0].focus).not.toHaveBeenCalled();
    rerenderWith({ visible: true });
    await act(async () => {});
    expect(mockTerminals[0].focus).toHaveBeenCalledTimes(1);
  });

  it("relays host output into xterm and keystrokes back to the host", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    sendCommand("desktopTerminalData", {
      termId: "term-main",
      data: "hello$ ",
    });
    expect(mockTerminals[0].written).toContain("hello$ ");
    act(() => mockTerminals[0].simulateInput("ls\n"));
    expect(postsOf(vscode, "desktopTerminalInput")).toEqual([
      { command: "desktopTerminalInput", termId: "term-main", data: "ls\n" },
    ]);
  });

  it("ignores terminal messages addressed to another termId", async () => {
    renderPane({ paneId: "pane-1" });
    await act(async () => {});
    sendCommand("desktopTerminalData", { termId: "term-pane-2", data: "nope" });
    expect(mockTerminals[0].written).toHaveLength(0);
  });

  it("shows the exited state with restart on desktopTerminalExit", async () => {
    renderPane();
    await act(async () => {});
    sendCommand("desktopTerminalExit", { termId: "term-main", exitCode: 137 });
    expect(screen.getByText("进程已退出（退出码 137）")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-retry")).toBeInTheDocument();
  });

  it("shows the error detail when the host reports a spawn failure", async () => {
    renderPane();
    await act(async () => {});
    sendCommand("desktopTerminalExit", {
      termId: "term-main",
      error: "终端启动失败：boom",
    });
    expect(screen.getByText("终端启动失败：boom")).toBeInTheDocument();
  });

  it("restart kills then re-creates the PTY and resets the xterm buffer", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    fireEvent.click(screen.getByTestId("terminal-restart"));
    expect(postsOf(vscode, "desktopTerminalKill")).toEqual([
      { command: "desktopTerminalKill", termId: "term-main" },
    ]);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(2);
    expect(mockTerminals[0].resetCount).toBe(1);
  });

  it("session switch rebuilds a visible terminal and kills a hidden one", async () => {
    const { vscode, rerenderWith } = renderPane({
      sessionId: "s1",
      workdir: "/w/a",
    });
    await act(async () => {});
    rerenderWith({ sessionId: "s2", workdir: "/w/b" });
    expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(1);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(2);
  });

  it("session switch on a hidden terminal kills without rebuild", async () => {
    const { vscode, rerenderWith } = renderPane({
      visible: false,
      sessionId: "s1",
      workdir: "/w/a",
    });
    await act(async () => {});
    // Simulate a PTY having been created earlier (visible phase), then hidden.
    rerenderWith({ visible: true, sessionId: "s1", workdir: "/w/a" });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
    rerenderWith({ visible: false, sessionId: "s1", workdir: "/w/a" });
    rerenderWith({ visible: false, sessionId: "s2", workdir: "/w/b" });
    expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(1);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
  });

  it("unmount disposes the terminal but leaves the PTY alive for reattach", async () => {
    const { vscode, unmount } = renderPane();
    await act(async () => {});
    unmount();
    // The host owns the PTY lifecycle: a remount (e.g. the pane moving
    // across window rows) reattaches to the live PTY instead of a respawn.
    expect(postsOf(vscode, "desktopTerminalKill")).toEqual([]);
    expect(mockTerminals[0].disposed).toBe(true);
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    renderPane({ onClose });
    await act(async () => {});
    fireEvent.click(screen.getByTestId("terminal-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("follows the app theme on desktopThemeChange", async () => {
    renderPane();
    await act(async () => {});
    const before = mockTerminals[0].options.theme;
    document.documentElement.style.setProperty(
      "--vscode-panel-background",
      "#112233",
    );
    sendCommand("desktopThemeChange", {});
    const after = mockTerminals[0].options.theme as { background: string };
    expect(after.background).toBe("#112233");
    expect(after).not.toBe(before);
    document.documentElement.style.removeProperty("--vscode-panel-background");
  });

  // Clicking a URL printed in the terminal routes the same way Message.tsx
  // does: any http(s) URL → preview pane, non-http(s) → the system default app.
  const linkHandlerOf = (term: MockTerminal) =>
    (
      term.addons.find((a) => a instanceof MockWebLinksAddon) as
        | MockWebLinksAddon
        | undefined
    )?.handler;

  it("routes a localhost link in the terminal to the preview pane", async () => {
    const onOpenPreview = vi.fn();
    const { vscode } = renderPane({ onOpenPreview });
    await act(async () => {});
    const handler = linkHandlerOf(mockTerminals[0]);
    expect(handler).toBeTruthy();

    act(() => handler!({} as MouseEvent, "http://localhost:5173/app"));

    expect(onOpenPreview).toHaveBeenCalledWith("http://localhost:5173/app");
    expect(postsOf(vscode, "openExternal")).toHaveLength(0);
  });

  it("routes a non-localhost http(s) link in the terminal to the preview pane", async () => {
    const onOpenPreview = vi.fn();
    const { vscode } = renderPane({ onOpenPreview });
    await act(async () => {});
    act(() =>
      linkHandlerOf(mockTerminals[0])!(
        {} as MouseEvent,
        "https://example.com/docs",
      ),
    );

    expect(onOpenPreview).toHaveBeenCalledWith("https://example.com/docs");
    expect(postsOf(vscode, "openExternal")).toHaveLength(0);
  });

  it("routes an artifact page link in the terminal to the system browser", async () => {
    // Artifact pages need the user's browser SSO session (the preview pane
    // has none), so they must not go through onOpenPreview.
    const onOpenPreview = vi.fn();
    const { vscode } = renderPane({ onOpenPreview });
    await act(async () => {});
    act(() =>
      linkHandlerOf(mockTerminals[0])!(
        {} as MouseEvent,
        "https://codechat.codewave.163.com/code/artifact/abc123",
      ),
    );

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(postsOf(vscode, "openExternal")).toEqual([
      {
        command: "openExternal",
        url: "https://codechat.codewave.163.com/code/artifact/abc123",
      },
    ]);
  });

  it("routes a non-http(s) link in the terminal to the system default app", async () => {
    const onOpenPreview = vi.fn();
    const { vscode } = renderPane({ onOpenPreview });
    await act(async () => {});
    act(() =>
      linkHandlerOf(mockTerminals[0])!(
        {} as MouseEvent,
        "file:///tmp/build.log",
      ),
    );

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(postsOf(vscode, "openExternal")).toEqual([
      { command: "openExternal", url: "file:///tmp/build.log" },
    ]);
  });

  it("falls back to the system browser for localhost when no onOpenPreview", async () => {
    // renderPane always wires onOpenPreview, so exercise the fallback by
    // rendering without the prop — mirrors Message.tsx's no-handler path.
    const vscode = createMockVscode();
    render(
      <TerminalPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={vi.fn()}
        visible={true}
      />,
    );
    await act(async () => {});
    act(() =>
      linkHandlerOf(mockTerminals[0])!(
        {} as MouseEvent,
        "http://127.0.0.1:3000",
      ),
    );

    expect(postsOf(vscode, "openExternal")).toEqual([
      { command: "openExternal", url: "http://127.0.0.1:3000" },
    ]);
  });

  it("shows an actionable error when the terminal chunk fails to load, and retry rebuilds", async () => {
    delete window.WaveTerminal;
    const vscode = createMockVscode();
    render(
      <TerminalPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={vi.fn()}
        visible={true}
      />,
    );
    // The injected script tag never loads in jsdom — fire its error.
    await act(async () => {});
    const script = document.head.querySelector('script[src="./terminal.js"]');
    expect(script).not.toBeNull();
    await act(async () => {
      script!.dispatchEvent(new Event("error"));
    });
    expect(screen.getByText("terminal.js 加载失败")).toBeInTheDocument();

    // Retry with the chunk now available rebuilds the terminal.
    window.WaveTerminal = {
      Terminal: MockTerminal,
      FitAddon: class {
        fit = vi.fn();
      },
      WebLinksAddon: MockWebLinksAddon as unknown as NonNullable<
        Window["WaveTerminal"]
      >["WebLinksAddon"],
    } as unknown as NonNullable<Window["WaveTerminal"]>;
    fireEvent.click(screen.getByTestId("terminal-retry"));
    await act(async () => {});
    expect(mockTerminals).toHaveLength(1);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
    script!.remove();
  });
});
