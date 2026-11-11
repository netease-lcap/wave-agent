import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

function renderDesktopApp() {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  return { ...result, vscode };
}

/** Flushes the hook's rAF-deferred initial item focus. */
const flushOpenFocus = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Keyboard accessibility of the desktop new-session selectors (host, workdir,
 * branch): triggers must be Tab-focusable, menu items activatable with
 * Enter/Space, Escape must close the menu and return focus to the trigger,
 * and Arrow keys move the roving-tabindex focus without wrapping.
 */
describe("desktop selector keyboard accessibility", () => {
  it("host trigger opens the menu with Enter and host items are Tab-focusable", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod", "stage"],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    const trigger = screen.getByTestId("desktop-host");
    expect(trigger).toHaveProperty("tabIndex", 0);

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("desktop-host-menu")).toBeInTheDocument();

    const localItem = screen.getByTestId("desktop-host-local");
    const sshItems = screen.getAllByTestId("desktop-host-item");
    const addItem = screen.getByTestId("desktop-host-add-entry");
    // Roving tabindex: the initially-focused item (本地) is the only tab stop.
    expect(localItem).toHaveProperty("tabIndex", 0);
    expect(sshItems).toHaveLength(2);
    expect(sshItems[0]).toHaveProperty("tabIndex", -1);
    expect(addItem).toHaveProperty("tabIndex", -1);
  });

  it("host menu icons: 本地 keeps its icon, the remote glyph sits on the SSH 主机 group label", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "local",
      hosts: ["prod", "stage"],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const menu = screen.getByTestId("desktop-host-menu");

    // 具体主机名不再各带一颗图标：图标只在「本地」行与分组标题行上（用户口径：
    // 把主机名前面那颗图标挪到「SSH 主机」前面，跟「本地」保持一致）。只看行的
    // 直接子节点——行尾「编辑连接」按钮里那颗是操作入口的图标，不是主机图标。
    for (const item of screen.getAllByTestId("desktop-host-item")) {
      expect(
        Array.from(item.children).filter((child) =>
          child.classList.contains("codicon"),
        ),
      ).toEqual([]);
    }
    const label = menu.querySelector(".desktop-host-menu-label");
    expect(label?.textContent).toBe("SSH 主机");
    expect(label?.querySelector(".codicon-remote")).not.toBeNull();
    expect(
      screen
        .getByTestId("desktop-host-local")
        .querySelector(".desktop-host-icon"),
    ).not.toBeNull();
  });

  it("host menu icons: the WSL 发行版 group follows the same rule as SSH 主机", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "local",
      hosts: ["prod"],
      hostOptions: [
        { id: "local", label: "本地", kind: "local" },
        { id: "wsl:Ubuntu-24.04", label: "Ubuntu-24.04", kind: "wsl" },
        { id: "wsl:Debian", label: "Debian", kind: "wsl" },
        { id: "prod", label: "prod", kind: "ssh" },
      ],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const menu = screen.getByTestId("desktop-host-menu");

    // 两个分组标题行都只有一颗图标（同一颗 codicon-remote），具体条目行一颗都不带。
    const labels = menu.querySelectorAll(".desktop-host-menu-label");
    expect(Array.from(labels).map((l) => l.textContent)).toEqual([
      "WSL 发行版",
      "SSH 主机",
    ]);
    for (const label of labels) {
      expect(label.querySelectorAll(".codicon-remote")).toHaveLength(1);
    }
    for (const item of screen.getAllByTestId("desktop-host-item")) {
      expect(
        Array.from(item.children).filter((child) =>
          child.classList.contains("codicon"),
        ),
      ).toEqual([]);
    }
  });

  it("host menu: no WSL distro installed → no WSL 发行版 group at all", () => {
    // 宿主在下发 hostOptions 时已经把「本机一台发行版都没装 / wsl.exe 不可用」
    // 过滤成「没有 wsl 项」（desktop-wsl.md 场景 1）。webview 不得自己补一个空
    // 分组或占位文案——那会让没装 WSL 的用户以为哪里坏了。
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "local",
      hosts: ["prod"],
      hostOptions: [
        { id: "local", label: "本地", kind: "local" },
        { id: "prod", label: "prod", kind: "ssh" },
      ],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const menu = screen.getByTestId("desktop-host-menu");

    const labels = menu.querySelectorAll(".desktop-host-menu-label");
    expect(Array.from(labels).map((l) => l.textContent)).toEqual(["SSH 主机"]);
    expect(screen.queryByText("WSL 发行版")).toBeNull();
  });

  it("host menu: with neither WSL nor SSH, only 本地 and 添加主机… remain", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "local",
      hosts: [],
      hostOptions: [{ id: "local", label: "本地", kind: "local" }],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const menu = screen.getByTestId("desktop-host-menu");

    expect(menu.querySelectorAll(".desktop-host-menu-label")).toHaveLength(0);
    expect(menu.querySelectorAll(".desktop-host-menu-items")).toHaveLength(0);
    expect(screen.getByTestId("desktop-host-local")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-host-add-entry")).toBeInTheDocument();
  });

  it("opens with focus on the first item which is activatable right away", async () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod"],
      recentWorkdirs: [],
    });
    // FR-032：pane record 的 host 是 effectiveHost 的权威来源——真实宿主切
    // 远端后 hostState + pushPanes 同步更新（spec desktop-layout.md「启动即
    // 单个分屏」）。镜像同一时序，让主机选择器把「本地」当作可切换项。
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", host: "prod", row: 0 }],
      focusedPaneId: "pane-1",
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    await flushOpenFocus();

    // Opening focuses 本地 so Enter immediately selects it.
    expect(document.activeElement).toBe(
      screen.getByTestId("desktop-host-local"),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectHost",
      host: "local",
    });
    expect(screen.queryByTestId("desktop-host-menu")).not.toBeInTheDocument();
  });

  it("moves the roving focus with Arrow keys without wrapping at the edges", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod"],
      recentWorkdirs: [],
    });
    // FR-032：pane record 的 host 是 effectiveHost 的权威来源——真实宿主切
    // 远端后 hostState + pushPanes 同步更新（spec desktop-layout.md「启动即
    // 单个分屏」）。镜像同一时序，让主机选择器把「本地」当作可切换项。
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", host: "prod", row: 0 }],
      focusedPaneId: "pane-1",
    });
    sendCommand("setInitialState", { messages: [] });

    fireEvent.click(screen.getByTestId("desktop-host"));
    const localItem = screen.getByTestId("desktop-host-local");
    const sshItem = screen.getAllByTestId("desktop-host-item")[0];
    const addItem = screen.getByTestId("desktop-host-add-entry");

    localItem.focus();
    fireEvent.keyDown(localItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(sshItem);
    expect(sshItem).toHaveProperty("tabIndex", 0);
    expect(localItem).toHaveProperty("tabIndex", -1);

    fireEvent.keyDown(sshItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(addItem);

    // Below the last item: clamped, focus stays on 添加主机….
    fireEvent.keyDown(addItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(addItem);

    fireEvent.keyDown(addItem, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowUp",
    });
    expect(document.activeElement).toBe(localItem);
    // Above the first item: clamped too.
    fireEvent.keyDown(localItem, { key: "ArrowUp" });
    expect(document.activeElement).toBe(localItem);
  });

  it("selects a host item with Enter and returns focus to the trigger", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod", "stage"],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const sshItem = screen.getAllByTestId("desktop-host-item")[1];
    sshItem.focus();
    fireEvent.keyDown(sshItem, { key: "Enter" });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectHost",
      host: "stage",
    });
    expect(screen.queryByTestId("desktop-host-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("desktop-host"));
  });

  it("selects the local host item with Space", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod"],
      recentWorkdirs: [],
    });
    // FR-032：pane record 的 host 是 effectiveHost 的权威来源——真实宿主切
    // 远端后 hostState + pushPanes 同步更新（spec desktop-layout.md「启动即
    // 单个分屏」）。镜像同一时序，让主机选择器把「本地」当作可切换项。
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", host: "prod", row: 0 }],
      focusedPaneId: "pane-1",
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const localItem = screen.getByTestId("desktop-host-local");
    localItem.focus();
    fireEvent.keyDown(localItem, { key: " " });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectHost",
      host: "local",
    });
  });

  it("closes the host menu with Escape and returns focus to the trigger", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod"],
      recentWorkdirs: [],
    });
    // FR-032：pane record 的 host 是 effectiveHost 的权威来源——真实宿主切
    // 远端后 hostState + pushPanes 同步更新（spec desktop-layout.md「启动即
    // 单个分屏」）。镜像同一时序，让主机选择器把「本地」当作可切换项。
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", host: "prod", row: 0 }],
      focusedPaneId: "pane-1",
    });
    sendCommand("setInitialState", { messages: [] });

    fireEvent.click(screen.getByTestId("desktop-host"));
    const sshItem = screen.getAllByTestId("desktop-host-item")[0];
    sshItem.focus();
    fireEvent.keyDown(sshItem, { key: "Escape" });

    expect(screen.queryByTestId("desktop-host-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("desktop-host"));
  });

  it("opens the connection form from the keyboard and saves with Enter", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "local",
      hosts: [],
      sshConnections: [],
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const addItem = screen.getByTestId("desktop-host-add-entry");
    addItem.focus();
    fireEvent.keyDown(addItem, { key: "Enter" });

    // 「添加主机…」不再展开 inline 输入行，而是打开连接表单（模态）。
    expect(screen.queryByTestId("desktop-host-menu")).not.toBeInTheDocument();
    const hostInput = screen.getByTestId("desktop-ssh-host");
    fireEvent.change(hostInput, { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByTestId("desktop-ssh-port"), {
      target: { value: "2222" },
    });
    fireEvent.keyDown(hostInput, { key: "Enter" });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopSaveSshConnection",
        input: expect.objectContaining({
          host: "user@example.com",
          port: "2222",
        }),
      }),
    );
  });

  it("workdir trigger opens the menu with Enter and recent items are Tab-focusable", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: ["/home/user/project-a", "/home/user/project-b"],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    const trigger = screen.getByTestId("desktop-workdir");
    expect(trigger).toHaveProperty("tabIndex", 0);

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("desktop-workdir-menu")).toBeInTheDocument();

    const items = screen.getAllByTestId("desktop-workdir-recent-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveProperty("tabIndex", 0);
  });

  it("selects a recent workdir with Enter and returns focus to the trigger", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: ["/home/user/project-a"],
    });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-workdir"));
    const item = screen.getByTestId("desktop-workdir-recent-item");
    item.focus();
    fireEvent.keyDown(item, { key: "Enter" });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectRecentWorkdir",
      path: "/home/user/project-a",
      host: "local",
    });
    expect(
      screen.queryByTestId("desktop-workdir-menu"),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("desktop-workdir"));
  });

  it("closes the workdir menu with Escape and returns focus to the trigger", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: ["/home/user/project-a"],
    });
    sendCommand("setInitialState", { messages: [] });

    fireEvent.click(screen.getByTestId("desktop-workdir"));
    const item = screen.getByTestId("desktop-workdir-recent-item");
    item.focus();
    fireEvent.keyDown(item, { key: "Escape" });

    expect(
      screen.queryByTestId("desktop-workdir-menu"),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("desktop-workdir"));
  });

  it("activates 浏览… with Enter and posts desktopSelectWorkdir", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", { messages: [] });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-workdir"));
    const browse = screen.getByTestId("desktop-workdir-browse");
    browse.focus();
    fireEvent.keyDown(browse, { key: "Enter" });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectWorkdir",
    });
    expect(
      screen.queryByTestId("desktop-workdir-menu"),
    ).not.toBeInTheDocument();
  });

  it("branch trigger opens the menu with Enter and items are Tab-focusable", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("setInitialState", { messages: [] });
    sendCommand("desktopGitBranches", {
      workdir: "/work/a",
      result: { branches: ["main", "dev"], current: "main" },
    });

    const trigger = screen.getByTestId("desktop-branch-selector");
    expect(trigger).toHaveProperty("tabIndex", 0);

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("desktop-branch-menu")).toBeInTheDocument();

    const items = screen.getAllByTestId("desktop-branch-item");
    expect(items).toHaveLength(2);
    // Roving tabindex: the initially-focused item (main, the current branch)
    // is the only tab stop.
    expect(items[0]).toHaveProperty("tabIndex", 0);
    expect(items[1]).toHaveProperty("tabIndex", -1);
  });

  it("opens focused on the currently selected branch even when it is not first", async () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("setInitialState", { messages: [] });
    sendCommand("desktopGitBranches", {
      workdir: "/work/a",
      result: { branches: ["main", "dev"], current: "dev" },
    });

    fireEvent.click(screen.getByTestId("desktop-branch-selector"));
    await flushOpenFocus();

    const items = screen.getAllByTestId("desktop-branch-item");
    // Opening focuses the current branch (permission-mode dropdown precedent).
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);
    expect(items[0]).toHaveProperty("tabIndex", 0);

    fireEvent.keyDown(items[0], { key: "Escape" });
    expect(screen.queryByTestId("desktop-branch-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByTestId("desktop-branch-selector"),
    );
  });

  it("selects a branch with Enter and returns focus to the trigger", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("setInitialState", { messages: [] });
    sendCommand("desktopGitBranches", {
      workdir: "/work/a",
      result: { branches: ["main", "dev"], current: "main" },
    });

    fireEvent.click(screen.getByTestId("desktop-branch-selector"));
    const items = screen.getAllByTestId("desktop-branch-item");
    items[1].focus();
    fireEvent.keyDown(items[1], { key: "Enter" });

    expect(screen.getByTestId("desktop-branch-selector")).toHaveTextContent(
      "dev",
    );
    expect(screen.queryByTestId("desktop-branch-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByTestId("desktop-branch-selector"),
    );
  });

  it("closes the branch menu with Escape and returns focus to the trigger", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/work/a",
      recentWorkdirs: ["/work/a"],
    });
    sendCommand("setInitialState", { messages: [] });
    sendCommand("desktopGitBranches", {
      workdir: "/work/a",
      result: { branches: ["main", "dev"], current: "main" },
    });

    fireEvent.click(screen.getByTestId("desktop-branch-selector"));
    const items = screen.getAllByTestId("desktop-branch-item");
    items[0].focus();
    fireEvent.keyDown(items[0], { key: "Escape" });

    expect(screen.queryByTestId("desktop-branch-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByTestId("desktop-branch-selector"),
    );
  });
});
