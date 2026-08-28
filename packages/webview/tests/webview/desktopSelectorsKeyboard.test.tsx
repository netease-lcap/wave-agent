import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

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

  it("opens with focus on the first item which is activatable right away", async () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "prod",
      hosts: ["prod"],
      recentWorkdirs: [],
    });
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

    fireEvent.click(screen.getByTestId("desktop-host"));
    const sshItem = screen.getAllByTestId("desktop-host-item")[0];
    sshItem.focus();
    fireEvent.keyDown(sshItem, { key: "Escape" });

    expect(screen.queryByTestId("desktop-host-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("desktop-host"));
  });

  it("opens the add-host input from the keyboard and submits with Enter", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      host: "local",
      hosts: [],
      recentWorkdirs: [],
    });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-host"));
    const addItem = screen.getByTestId("desktop-host-add-entry");
    addItem.focus();
    fireEvent.keyDown(addItem, { key: "Enter" });

    const input = screen.getByPlaceholderText("ssh user@hostname -p port");
    fireEvent.change(input, {
      target: { value: "ssh user@example.com -p 2222" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopAddHost",
      connectionString: "ssh user@example.com -p 2222",
    });
    expect(screen.queryByTestId("desktop-host-menu")).not.toBeInTheDocument();
  });

  it("workdir trigger opens the menu with Enter and recent items are Tab-focusable", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: ["/home/user/project-a", "/home/user/project-b"],
    });
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
