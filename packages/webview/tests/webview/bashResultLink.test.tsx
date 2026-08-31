import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { BASH_TOOL_NAME } from "wave-agent-sdk";
import type { Message as MessageType } from "../../src/types";

// bash 命令输出中的裸 http(s) URL 应被链接化（见 specs/ui/markdown-links.md），
// 点击路由与消息文本链接一致：desktop 上 localhost → 预览面板、其余 → 系统
// 浏览器；IDE 保持原生链接处理。

function renderBashMessage(
  result: string,
  options?: {
    hostType?: string;
    onOpenPreview?: (url: string) => void;
  },
) {
  const vscode = createMockVscode();
  if (options?.hostType) {
    window.waveHostType = options.hostType;
  }
  const message = {
    id: "msg-bash-1",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        parameters: JSON.stringify({ command: "python -m http.server 8000" }),
        compactParams: "python -m http.server 8000",
        stage: "end",
        success: true,
        result,
      },
    ],
  } as unknown as MessageType;
  const rendered = render(
    <Message
      message={message}
      vscode={vscode}
      onOpenPreview={options?.onOpenPreview}
    />,
  );
  const output = rendered.container.querySelector(".bash-command-output");
  return {
    ...rendered,
    vscode,
    output,
    link: output?.querySelector("a") as HTMLElement | null,
  };
}

afterEach(() => {
  delete window.waveHostType;
});

describe("bash result URL linkification", () => {
  it("renders a bare http URL in the output as a clickable link", () => {
    const { output, link } = renderBashMessage(
      "Serving HTTP on 0.0.0.0 port 8000 (http://localhost:8000/) ...",
    );
    expect(output).toBeInTheDocument();
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("http://localhost:8000/");
    // 其余文本保持原样
    expect(output).toHaveTextContent(
      "Serving HTTP on 0.0.0.0 port 8000 (http://localhost:8000/) ...",
    );
  });

  it("desktop host: localhost link opens the preview pane", () => {
    const onOpenPreview = vi.fn();
    const { vscode, link } = renderBashMessage(
      "Server started at http://localhost:5173/app",
      { onOpenPreview, hostType: "desktop" },
    );

    const notPrevented = fireEvent.click(link!);

    expect(onOpenPreview).toHaveBeenCalledWith("http://localhost:5173/app");
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it("desktop host: non-localhost link goes to the system browser", () => {
    const onOpenPreview = vi.fn();
    const { vscode, link } = renderBashMessage("curl https://example.com/api", {
      onOpenPreview,
      hostType: "desktop",
    });

    fireEvent.click(link!);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "https://example.com/api",
    });
  });

  it("IDE host: links are not intercepted", () => {
    const onOpenPreview = vi.fn();
    const { vscode, link } = renderBashMessage("see https://example.com/docs", {
      onOpenPreview,
    });

    const notPrevented = fireEvent.click(link!);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true); // default navigation preserved
  });

  it("strips trailing punctuation from the link target", () => {
    const { link } = renderBashMessage("visit https://example.com. 继续");
    expect(link!.getAttribute("href")).toBe("https://example.com");
    expect(link!.textContent).toBe("https://example.com");
  });

  it("keeps non-URL output as plain text without links", () => {
    const { output, link } = renderBashMessage("error: command not found");
    expect(output).toHaveTextContent("error: command not found");
    expect(link).toBeNull();
  });

  it("escapes HTML in the output so scripts are inert", () => {
    const { output, link } = renderBashMessage(
      "<script>alert(1)</script>\nhttp://a.com",
    );
    expect(output!.querySelector("script")).toBeNull();
    expect(output).toHaveTextContent("<script>alert(1)</script>");
    expect(link!.getAttribute("href")).toBe("http://a.com");
  });
});
