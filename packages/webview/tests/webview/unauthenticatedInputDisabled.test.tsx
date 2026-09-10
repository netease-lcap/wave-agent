import { describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
// Import test-utils to trigger its file-level vi.mock setup (mermaid/dompurify/CSS/ResizeObserver).
import {
  render,
  screen,
  createMockVscode,
  sendExtensionMessage,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";

/**
 * 未认证时发送入口禁用（spec `docs/specs/enterprise/sso-auth.md`）。
 *
 * 历史：这里原来是一条反向用例（`unauthenticatedInputEnabled`），断言「未登录时输入框
 * 也必须可编辑」，理由是那时用户可以在设置页填「直连 LLM 凭据」而不登录。PR-1 把凭据
 * 输入控件与免登录旁路整体下线后，该理由不复存在：未登录必然发不出消息（实测：无凭据
 * 时既无模型请求也不报错，只是静默挂住），所以入口本身就置灰，原因写在占位文案里。
 */
describe("Unauthenticated input disabled", () => {
  /** 渲染 IDE 宿主并推一份不含 isAuthenticated 的快照（= 未登录的真实状态）。 */
  function renderUnauthenticated(vscode: ReturnType<typeof createMockVscode>) {
    render(<ChatApp vscode={vscode as never} />);
    // setInitialState（空快照、无 isAuthenticated 字段）把 webview 标记为
    // initialized，让输入区渲染出来而不是停在扫光动画上；isAuthenticated 保持
    // 初值 false，即未登录。
    sendExtensionMessage({ command: "setInitialState", messages: [] });
  }

  it("未登录时输入框不可编辑、发送/附件/更多按钮全部禁用", () => {
    const vscode = createMockVscode();
    renderUnauthenticated(vscode);

    expect(screen.getByTestId("message-input")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.getByTestId("send-btn")).toBeDisabled();
    expect(screen.getByLabelText("添加")).toBeDisabled();
    expect(screen.getByLabelText("快捷指令")).toBeDisabled();
    expect(screen.getByLabelText("权限模式")).toBeDisabled();
  });

  it("未登录时输入框占位文案即为禁用原因（不新增提示行、不放登录按钮）", () => {
    const vscode = createMockVscode();
    renderUnauthenticated(vscode);

    const input = screen.getByTestId("message-input");
    expect(input.getAttribute("data-placeholder")).toBe("请先登录后再发送消息");

    // 禁用原因只写在输入框里：输入区内不出现登录按钮或「请去某处登录」的指路文案。
    const container = screen.getByTestId("input-container");
    expect(container.querySelector("button[aria-label*='登录']")).toBeNull();
    expect(container.textContent).not.toContain("请去");
  });

  it("未登录时按 Enter 不发出 sendMessage", () => {
    const vscode = createMockVscode();
    renderUnauthenticated(vscode);
    vscode.postMessage.mockClear();

    fireEvent.keyDown(screen.getByTestId("message-input"), {
      key: "Enter",
      shiftKey: false,
    });

    expect(
      vscode.postMessage.mock.calls
        .map((c) => c[0])
        .find((m: Record<string, unknown>) => m.command === "sendMessage"),
    ).toBeUndefined();
  });

  it("登录后恢复可编辑，占位文案回到默认提示（禁用原因不残留）", () => {
    const vscode = createMockVscode();
    renderUnauthenticated(vscode);

    sendExtensionMessage({
      command: "authStatusResponse",
      isAuthenticated: true,
    });

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("contenteditable", "true");
    expect(input.getAttribute("data-placeholder")).toBe(
      "/快捷指令，@添加上下文，粘贴图片，Enter发送...",
    );
    expect(screen.getByLabelText("添加")).toBeEnabled();
    expect(screen.getByLabelText("快捷指令")).toBeEnabled();
    expect(screen.getByLabelText("权限模式")).toBeEnabled();
  });
});
