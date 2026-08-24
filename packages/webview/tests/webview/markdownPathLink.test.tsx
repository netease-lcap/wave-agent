import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { MockDataGenerator } from "../fixtures/mockData";

// Mermaid is heavy and irrelevant here; stub it out. DOMPurify must stay REAL so
// these tests exercise the actual sanitize whitelist in Message.tsx.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

function renderAssistantMessage(
  content: string,
  extra?: Partial<React.ComponentProps<typeof Message>>,
) {
  const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  const message = MockDataGenerator.createAssistantMessage(content);
  return {
    vscode,
    ...render(<Message message={message} vscode={vscode} {...extra} />),
  };
}

const pathLinks = (container: HTMLElement) =>
  container.querySelectorAll(".markdown-content code a.clickable-path");

describe("inline-code file path elevation (specs/ui/markdown-links.md)", () => {
  it("elevates a known-extension relative path to a clickable link, keeping the code style", () => {
    const { container } = renderAssistantMessage(
      "修改了 `src/main.ts` 和 `packages/webview/src/App.tsx`",
    );
    const links = pathLinks(container);
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toBe("src/main.ts");
    expect(links[0]?.getAttribute("href")).toBe("#");
  });

  it("elevates absolute POSIX and Windows paths", () => {
    const { container } = renderAssistantMessage(
      "位置 `/Users/me/proj/src/main.ts` 或 `C:\\Users\\me\\proj\\src\\main.ts`",
    );
    const links = pathLinks(container);
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toBe("/Users/me/proj/src/main.ts");
    expect(links[1]?.textContent).toBe("C:\\Users\\me\\proj\\src\\main.ts");
  });

  it("elevates ./ and ../ relative paths", () => {
    const { container } = renderAssistantMessage(
      "看 `./src/utils/parse.ts` 与 `../lib/index.ts`",
    );
    const links = pathLinks(container);
    expect(links).toHaveLength(2);
  });

  it("elevates known dotfiles and well-known filenames", () => {
    const { container } = renderAssistantMessage(
      "改 `.gitignore`、`Dockerfile` 和 `.env.local`",
    );
    const links = pathLinks(container);
    expect(links).toHaveLength(3);
  });

  it("parses a :line suffix and routes the click to onOpenFile (desktop panel)", () => {
    const onOpenFile = vi.fn();
    const { container } = renderAssistantMessage("问题在 `src/main.ts:42`", {
      onOpenFile,
    });
    const link = container.querySelector("a.clickable-path");
    expect(link).not.toBeNull();
    fireEvent.click(link as Element);
    expect(onOpenFile).toHaveBeenCalledWith("src/main.ts", 42, undefined);
  });

  it("splits a Windows drive path with line suffix at the last colon", () => {
    const onOpenFile = vi.fn();
    const { container } = renderAssistantMessage("见 `C:\\dir\\file.ts:7`", {
      onOpenFile,
    });
    const link = container.querySelector("a.clickable-path");
    expect(link).not.toBeNull();
    fireEvent.click(link as Element);
    expect(onOpenFile).toHaveBeenCalledWith("C:\\dir\\file.ts", 7, undefined);
  });

  it("falls back to the openFile RPC on IDE hosts (no onOpenFile prop)", () => {
    const { container, vscode } = renderAssistantMessage("编辑 `src/index.ts`");
    const link = container.querySelector("a.clickable-path");
    expect(link).not.toBeNull();
    fireEvent.click(link as Element);
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      path: "src/index.ts",
      startLine: undefined,
      endLine: undefined,
    });
  });

  it("keeps non-path inline code as plain code (expressions, bare names, versions)", () => {
    const { container } = renderAssistantMessage(
      "表达式 `var x = 1`、裸名 `main`、版本 `1.2`、无协议 `www.example.com`",
    );
    expect(container.querySelectorAll(".markdown-content a")).toHaveLength(0);
    expect(container.querySelectorAll(".markdown-content code")).toHaveLength(
      4,
    );
  });

  it("keeps unknown-extension names plain but elevates them when they contain a separator", () => {
    const { container } = renderAssistantMessage(
      "`report.final` 不判，`docs/report.final` 判",
    );
    const links = pathLinks(container);
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe("docs/report.final");
  });

  it("still renders URLs as links without the path class", () => {
    const { container } = renderAssistantMessage(
      "看 `https://example.com/a/b`",
    );
    expect(pathLinks(container)).toHaveLength(0);
    const link = container.querySelector(".markdown-content code a");
    expect(link?.getAttribute("href")).toBe("https://example.com/a/b");
  });

  it("escapes HTML inside a clickable path", () => {
    const { container } = renderAssistantMessage("注入 `x.ts<script>`");
    expect(container.querySelector("a.clickable-path script")).toBeNull();
  });
});
