import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

/**
 * 桌面端专属元素（右上角关闭键、焦点陷阱）靠 `isDesktopHost()` 门控，
 * 而它读的是 preload 注入的 `window.waveHostType` —— 测试环境默认没有。
 */
beforeEach(() => {
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
});

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

  // 契约 :71「Keep the visible error explanation, aria-invalid and **description
  // association**」+ :147「8px from their associated control」。
  // 原来错误行挂在字段块之外：不管哪一栏出错，红字都堆在「私钥」下面，而且只有
  // 主机栏有 aria-invalid（端口出错也标红主机）、全表单没有 aria-describedby。
  it("puts each field's error under that field and wires aria-describedby", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    fill("desktop-ssh-host", "user@example.com");
    fill("desktop-ssh-port", "70000");
    fireEvent.click(screen.getByTestId("desktop-ssh-save"));

    const error = screen.getByTestId("desktop-ssh-error");
    expect(error).toHaveTextContent("端口必须是 1–65535 的数字");

    const port = screen.getByTestId("desktop-ssh-port");
    const hostInput = screen.getByTestId("desktop-ssh-host");
    // 错误行是「端口」那一组的孩子 —— 不是表单底部的孤儿
    expect(port.closest(".ssh-conn-field")?.contains(error)).toBe(true);
    expect(port).toHaveAttribute("aria-invalid", "true");
    expect(port).toHaveAttribute("aria-describedby", error.id);
    // 主机这一栏没毛病就不该标红
    expect(hostInput).not.toHaveAttribute("aria-invalid");
    expect(hostInput).not.toHaveAttribute("aria-describedby");
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

  // 2026-11-12 审计 A7：桌面端模态按契约要求带右上角关闭控件
  // （common-components.md:126/:144「a top-right close control」）。
  it("closes from the top-right close control without posting anything", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    const close = screen.getByTestId("desktop-ssh-close");
    expect(close).toHaveAttribute("aria-label", "关闭");
    fireEvent.click(close);

    expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull();
    expect(lastPost(host.vscode, "desktopSaveSshConnection")).toBeUndefined();
  });

  // 审计 D2：文案写在 JSX 里跨行时，换行会被折成一个空格（「最近 打开目录」）。
  // 用 textContent 精确断言 —— toHaveTextContent 会规范化空白，抓不到这个 bug。
  it("renders the delete explanation without a stray space", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openEditForm();

    fireEvent.click(screen.getByTestId("desktop-ssh-delete"));
    const text =
      screen.getByTestId("desktop-ssh-delete-confirm").textContent ?? "";
    expect(text).toContain("最近打开目录会保留");
    expect(text).not.toContain("最近 打开");
  });

  // 契约 :120「appropriate Escape/close behavior」是模态级的：原来 Esc 只在
  // 输入框里处理（onFieldKeyDown），焦点落到按钮上就关不掉。
  it("Escape closes the form from a button too, not just from an input", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    const save = screen.getByTestId("desktop-ssh-save");
    save.focus();
    fireEvent.keyDown(save, { key: "Escape" });

    expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull();
    expect(lastPost(host.vscode, "desktopSaveSshConnection")).toBeUndefined();
  });

  // 审计 E3：契约 :120「restoration to the trigger」—— 关掉弹窗焦点要回到触发键，
  // 不能落成 body（键盘 / 屏幕阅读器用户会掉回文档开头）。
  // 真实路径里是宿主 `closeReturningFocus()` 先把焦点还给「主机」触发键、再挂载弹窗；
  // fireEvent.click 自己不移动焦点，所以这里显式 focus 一次代替那一步。
  it("returns focus to the host trigger when the form closes", async () => {
    const host = renderDesktopApp();
    seedHosts(host);

    const trigger = screen.getByTestId("desktop-host");
    trigger.focus();
    openAddForm();

    fireEvent.click(screen.getByTestId("desktop-ssh-cancel"));

    expect(screen.queryByTestId("desktop-ssh-connection-dialog")).toBeNull();
    // 归还动作推了一帧（点遮罩关闭时浏览器的 mousedown 默认动作会把焦点收到
    // body，同步 focus() 会被它盖掉），所以这里等一帧。
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  // 审计 E2：契约 :120「focus containment」—— Tab 到最后一颗要折回第一颗，
  // 不能跑到弹窗背后的页面上。DOM 顺序是「关闭键 → 名称 → 主机 → 端口 → 私钥
  // → 取消 → 保存」，所以末位是「保存」、首位是「关闭键」。
  it("keeps Tab focus inside the dialog", () => {
    const host = renderDesktopApp();
    seedHosts(host);
    openAddForm();

    const save = screen.getByTestId("desktop-ssh-save");
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });

    // fireEvent 自己不会移动焦点 —— activeElement 变了只能是陷阱逻辑做了事。
    expect(document.activeElement).toBe(
      screen.getByTestId("desktop-ssh-close"),
    );
  });
});
