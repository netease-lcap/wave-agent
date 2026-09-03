import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// Mermaid is heavy and irrelevant here; stub it out (same pattern as
// markdownInlineLink.test.tsx). DOMPurify must stay REAL so these tests
// exercise the actual sanitize whitelist.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

function renderMessage(content: string, options?: { workdir?: string }) {
  const vscode = createMockVscode();
  const message = MockDataGenerator.createAssistantMessage(content);
  const onOpenFile = vi.fn();
  const result = render(
    <Message
      message={message}
      vscode={vscode}
      workdir={options?.workdir}
      onOpenFile={onOpenFile}
    />,
  );
  const fileLinks = () =>
    Array.from(
      result.container.querySelectorAll(".markdown-content a.file-path-link"),
    ) as HTMLElement[];
  const codeLinks = () =>
    Array.from(
      result.container.querySelectorAll(".markdown-content code a"),
    ) as HTMLElement[];
  return { ...result, vscode, onOpenFile, fileLinks, codeLinks };
}

// Render WITHOUT onOpenFile → IDE host shape: clicks fall back to the
// openFile RPC on vscode.postMessage (same channel as Read/Write headers).
function renderIdeMessage(content: string, options?: { workdir?: string }) {
  const vscode = createMockVscode();
  const message = MockDataGenerator.createAssistantMessage(content);
  const result = render(
    <Message message={message} vscode={vscode} workdir={options?.workdir} />,
  );
  const fileLinks = () =>
    Array.from(
      result.container.querySelectorAll(".markdown-content a.file-path-link"),
    ) as HTMLElement[];
  return { ...result, vscode, fileLinks };
}

afterEach(() => {
  delete window.waveHostType;
});

describe("inline-code channel file paths (specs/ui/file-path-links.md)", () => {
  it("linkifies a code path with :N-M suffix, keeping code style and the suffix text", () => {
    const { fileLinks, codeLinks } = renderMessage(
      "见 `src/utils/format.ts:12-24`",
      { workdir: "/home/u/repo" },
    );
    const links = fileLinks();
    expect(links).toHaveLength(1);
    expect(codeLinks()).toHaveLength(1);
    expect(links[0]).toHaveTextContent("src/utils/format.ts:12-24");
    // Stays inside the code span (monospace + background) and is a real anchor
    // (href present → Enter activates it natively, spec scenario: keyboard).
    expect(links[0]?.closest("code")).not.toBeNull();
    expect(links[0]?.getAttribute("href")).toBe("#");
  });

  it("click (desktop, onOpenFile) joins the relative path to workdir and passes the line range", () => {
    const { onOpenFile, fileLinks } = renderMessage(
      "见 `src/utils/format.ts:12-24`",
      { workdir: "/home/u/repo" },
    );
    fireEvent.click(fileLinks()[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/home/u/repo/src/utils/format.ts",
      12,
      24,
    );
  });

  it("click on a :N single-line suffix passes startLine === endLine", () => {
    const { onOpenFile, fileLinks } = renderMessage("看 `src/format.ts:9`", {
      workdir: "/home/u/repo",
    });
    fireEvent.click(fileLinks()[0]!);
    expect(onOpenFile).toHaveBeenCalledWith("/home/u/repo/src/format.ts", 9, 9);
  });

  it("click (IDE, no onOpenFile) emits the openFile RPC with path + line range", () => {
    const { vscode, fileLinks } = renderIdeMessage(
      "见 `src/utils/format.ts:12-24`",
      { workdir: "/home/u/repo" },
    );
    fireEvent.click(fileLinks()[0]!);
    const sent = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const openFileMsg = sent.find(
      (m: { command: string }) => m.command === "openFile",
    ) as Record<string, unknown>;
    expect(openFileMsg).toBeDefined();
    expect(openFileMsg.path).toBe("/home/u/repo/src/utils/format.ts");
    expect(openFileMsg.startLine).toBe(12);
    expect(openFileMsg.endLine).toBe(24);
  });

  it("keeps an inline-code relative path as plain code when there is no workdir (no opener context)", () => {
    const { container, fileLinks } = renderMessage("见 `src/main.ts`");
    expect(fileLinks()).toHaveLength(0);
    const code = container.querySelector(".markdown-content code");
    expect(code?.textContent).toBe("src/main.ts");
  });

  it("linkifies absolute paths in code even without workdir", () => {
    const { onOpenFile, fileLinks } = renderMessage("看 `/etc/nginx.conf`");
    const links = fileLinks();
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/etc/nginx.conf",
      undefined,
      undefined,
    );
  });

  it("click on a Windows absolute code path forwards it verbatim", () => {
    const { onOpenFile, fileLinks } = renderMessage(
      "见 `C:\\proj\\src\\a.ts:5`",
    );
    const links = fileLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("C:\\proj\\src\\a.ts:5");
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith("C:\\proj\\src\\a.ts", 5, 5);
  });

  it("does NOT linkify non-path inline code (no slash / no extension / multi-word)", () => {
    const { container, fileLinks } = renderMessage(
      "变量 `var x = 1`、`www.example.com`、`/foo`、`a.ts`",
    );
    expect(fileLinks()).toHaveLength(0);
    expect(container.querySelectorAll(".markdown-content code")).toHaveLength(
      4,
    );
  });

  it("treats ~/ paths in code as plain text (no host home dir to expand)", () => {
    const { container, fileLinks } = renderMessage("看 `~/dev/proj/x.ts`");
    expect(fileLinks()).toHaveLength(0);
    const code = container.querySelector(".markdown-content code");
    expect(code?.textContent).toBe("~/dev/proj/x.ts");
  });
});

describe("plain-text channel absolute paths (specs/ui/file-path-links.md)", () => {
  it("linkifies bare POSIX absolute paths in prose", () => {
    const { fileLinks } = renderMessage(
      "参考 /etc/hosts 与 /home/u/repo/src/index.ts 的实现",
    );
    const links = fileLinks();
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("/etc/hosts");
    expect(links[1]).toHaveTextContent("/home/u/repo/src/index.ts");
  });

  it("keeps adjacent punctuation outside the link and visible", () => {
    const { container, fileLinks } = renderMessage(
      "参见 /etc/hosts，然后看 /tmp/a.ts。",
    );
    const links = fileLinks();
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("/etc/hosts");
    expect(links[1]).toHaveTextContent("/tmp/a.ts");
    // 中文逗号/句号不进链接目标
    expect(links[0]?.textContent).not.toContain("，");
    expect(links[1]?.textContent).not.toContain("。");
    // 但整体文本保留原标点
    expect(container.querySelector(".markdown-content")?.textContent).toContain(
      "/etc/hosts，",
    );
    expect(container.querySelector(".markdown-content")?.textContent).toContain(
      "/tmp/a.ts。",
    );
  });

  it("does NOT linkify relative paths, ~/ paths or bare filenames in prose", () => {
    const { fileLinks } = renderMessage(
      "相对 src/main.ts 与 ~/dev/proj/tsconfig.json 与裸 index.ts 保持文本",
    );
    expect(fileLinks()).toHaveLength(0);
  });

  it("linkifies Windows and file:/// absolute paths in prose", () => {
    const { fileLinks } = renderMessage(
      "看 C:\\proj\\src\\a.ts 与 file:///home/u/a.ts",
    );
    const links = fileLinks();
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("C:\\proj\\src\\a.ts");
    expect(links[1]).toHaveTextContent("file:///home/u/a.ts");
  });

  it("click on a file:/// prose path strips the scheme before opening", () => {
    const { onOpenFile, fileLinks } = renderMessage("见 file:///home/u/a.ts");
    fireEvent.click(fileLinks()[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/home/u/a.ts",
      undefined,
      undefined,
    );
  });

  it("linkifies absolute paths inside bold/italic text and headings", () => {
    const { container, fileLinks } = renderMessage(
      "**请改 /tmp/bug.ts** 与 *看 /var/log/syslog*",
    );
    const links = fileLinks();
    expect(links).toHaveLength(2);
    expect(
      container.querySelector(".markdown-content strong a.file-path-link"),
    ).not.toBeNull();
    expect(
      container.querySelector(".markdown-content em a.file-path-link"),
    ).not.toBeNull();
  });

  it("does NOT create a nested path link inside a markdown link label", () => {
    const { container, fileLinks } = renderMessage(
      "[说明 /tmp/bug.ts](https://example.com/x)",
    );
    // 外层普通链接保留，label 内不产生 file-path-link
    expect(fileLinks()).toHaveLength(0);
    const outer = container.querySelector(".markdown-content a");
    expect(outer).not.toBeNull();
    expect(outer?.getAttribute("href")).toBe("https://example.com/x");
    expect(outer?.textContent).toContain("/tmp/bug.ts");
  });
});
