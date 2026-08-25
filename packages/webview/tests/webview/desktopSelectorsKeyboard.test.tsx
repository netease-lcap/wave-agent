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

/**
 * Keyboard accessibility of the desktop new-session selectors (host, workdir,
 * branch): triggers must be Tab-focusable, menu items activatable with
 * Enter/Space, and Escape must close the menu and return focus to the trigger.
 * Same pattern as the + / permission-mode dropdowns (plusMenuKeyboard.test.tsx).
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
    expect(localItem).toHaveProperty("tabIndex", 0);
    expect(sshItems).toHaveLength(2);
    expect(sshItems[0]).toHaveProperty("tabIndex", 0);
    expect(addItem).toHaveProperty("tabIndex", 0);
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
    expect(items[0]).toHaveProperty("tabIndex", 0);
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
