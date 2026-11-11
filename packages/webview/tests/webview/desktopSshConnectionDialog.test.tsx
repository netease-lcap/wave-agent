import { describe, it, expect } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

/**
 * SSH 连接表单（spec desktop-remote.md 场景 5/29/30/31）。
 *
 * 对齐 Claude Code 桌面端：主机列表是**应用自己的连接条目**，「添加主机…」用一张
 * 表单收名称/主机/端口/私钥，保存/删除都走请求-响应（`desktopSshConnectionResult`
 * + requestId）——宿主是校验与落盘的唯一权威，失败原因要留在弹窗里就地显示。
 */
function renderDesktopApp() {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  return { ...result, vscode };
}

/** 一条已存在的连接条目：编辑与判重用例都以它为背景。 */
const existingConnection = {
  id: "ssh-1",
  name: "生产机",
  host: "prod",
  port: 2200,
};

function seedHosts(host: ReturnType<typeof renderDesktopApp>) {
  sendCommand("desktopWorkdirState", {
    host: "local",
    hosts: [existingConnection.id],
    hostOptions: [
      { id: "local", label: "本地", kind: "local" },
      {
        id: existingConnection.id,
        label: existingConnection.name,
        kind: "ssh",
      },
    ],
    sshConnections: [existingConnection],
    recentWorkdirs: [],
  });
  sendCommand("setInitialState", { messages: [] });
  host.vscode.postMessage.mockClear();
}

/** 取出最近一条指定命令的 webview → host 消息。 */
function lastPost(
  vscode: ReturnType<typeof createMockVscode>,
  command: string,
): Record<string, unknown> | undefined {
  const calls = vscode.postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter((message) => message?.command === command);
  return calls[calls.length - 1];
}

const openAddForm = () => {
  fireEvent.click(screen.getByTestId("desktop-host"));
  fireEvent.click(screen.getByTestId("desktop-host-add-entry"));
  return screen.getByTestId("desktop-ssh-connection-dialog");
};

const openEditForm = () => {
  fireEvent.click(screen.getByTestId("desktop-host"));
  fireEvent.click(screen.getByTestId("desktop-host-edit"));
  return screen.getByTestId("desktop-ssh-connection-dialog");
};

const fill = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("SSH connection dialog", () => {
  it("saves the filled form with a requestId and closes on the host's confirmation", async () => {
    const host = renderDesktopApp();
    seedHosts(host);
    const dialog = openAddForm();
    expect(dialog).toHaveTextContent("添加 SSH 连接");

    fill("desktop-ssh-name", "测试机");
    fill("desktop-ssh-host", "user@example.com");
    fill("desktop-ssh-port", "2222");
    fill("desktop-ssh-identity", "~/.ssh/prod_ed25519");
    fireEvent.click(screen.getByTestId("desktop-ssh-save"));

    const request = lastPost(host.vscode, "desktopSaveSshConnection");
    expect(request).toMatchObject({
      input: {
        name: "测试机",
        host: "user@example.com",
        port: "2222",
        identityFile: "~/.ssh/prod_ed25519",
      },
    });
    // 待确认期间弹窗不关：宿主可能因为同主机重复或写盘失败而拒绝。
    expect(screen.getByTestId("desktop-ssh-connection-dialog")).toBeTruthy();

    sendCommand("desktopSshConnectionResult", {
      requestId: request?.requestId,
      ok: true,
      id: "ssh-2",
    });

    await waitFor(() =>
      expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull(),
    );
  });

  it("keeps the dialog open with the host's reason when the save is refused", async () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    fill("desktop-ssh-host", "user@example.com");
    fireEvent.click(screen.getByTestId("desktop-ssh-save"));
    const request = lastPost(host.vscode, "desktopSaveSshConnection");

    sendCommand("desktopSshConnectionResult", {
      requestId: request?.requestId,
      ok: false,
      error: "保存失败：连接库未能写入磁盘",
    });

    await waitFor(() =>
      expect(screen.getByTestId("desktop-ssh-error")).toHaveTextContent(
        "保存失败：连接库未能写入磁盘",
      ),
    );
    expect(screen.getByTestId("desktop-ssh-connection-dialog")).toBeTruthy();
    // 主机栏标红，用户一眼看到该改哪个字段。
    expect(screen.getByTestId("desktop-ssh-host")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("refuses a duplicate host locally without bothering the host", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    fill("desktop-ssh-host", existingConnection.host);
    fireEvent.click(screen.getByTestId("desktop-ssh-save"));

    expect(screen.getByTestId("desktop-ssh-error")).toHaveTextContent(
      `已有使用该主机的连接：${existingConnection.name}`,
    );
    expect(lastPost(host.vscode, "desktopSaveSshConnection")).toBeUndefined();
  });

  it("edits an existing entry in place, sending its id so the binding survives", async () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openEditForm();

    // 表单回填已有条目，保存时带上 id（宿主据此原地改，不动绑定关系）。
    expect(
      screen.getByTestId("desktop-ssh-connection-dialog"),
    ).toHaveTextContent("编辑 SSH 连接");
    expect(screen.getByTestId("desktop-ssh-host")).toHaveValue(
      existingConnection.host,
    );
    expect(screen.getByTestId("desktop-ssh-port")).toHaveValue("2200");

    fill("desktop-ssh-name", "生产机 A");
    fireEvent.click(screen.getByTestId("desktop-ssh-save"));

    const request = lastPost(host.vscode, "desktopSaveSshConnection");
    expect(request).toMatchObject({
      input: { id: existingConnection.id, name: "生产机 A" },
    });

    sendCommand("desktopSshConnectionResult", {
      requestId: request?.requestId,
      ok: true,
      id: existingConnection.id,
    });

    await waitFor(() =>
      expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull(),
    );
  });

  it("deletes an entry only after a second confirmation", async () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openEditForm();

    // 删除是两步：先说明影响，再执行。
    fireEvent.click(screen.getByTestId("desktop-ssh-delete"));
    expect(screen.getByTestId("desktop-ssh-delete-confirm")).toHaveTextContent(
      "不再自动重连",
    );
    expect(lastPost(host.vscode, "desktopDeleteSshConnection")).toBeUndefined();

    fireEvent.click(screen.getByTestId("desktop-ssh-delete-confirm-button"));
    const request = lastPost(host.vscode, "desktopDeleteSshConnection");
    expect(request).toMatchObject({ id: existingConnection.id });
    expect(screen.getByTestId("desktop-ssh-connection-dialog")).toBeTruthy();

    sendCommand("desktopSshConnectionResult", {
      requestId: request?.requestId,
      ok: true,
      id: existingConnection.id,
    });

    await waitFor(() =>
      expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull(),
    );
  });

  it("Escape closes the form without posting anything", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    fireEvent.keyDown(screen.getByTestId("desktop-ssh-host"), {
      key: "Escape",
    });

    expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull();
    expect(lastPost(host.vscode, "desktopSaveSshConnection")).toBeUndefined();
  });
});
