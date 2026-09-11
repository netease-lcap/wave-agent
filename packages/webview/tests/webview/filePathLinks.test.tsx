import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import { BASH_TOOL_NAME } from "wave-agent-sdk";
import type { Message as MessageType } from "../../src/types";

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

  it("linkifies inline-code paths with Chinese/non-ASCII filenames and opens them verbatim", () => {
    const { onOpenFile, fileLinks } = renderMessage(
      "见 `C:\\Users\\张三\\下载\\报表.xlsx` 与 `src/我的组件.tsx:8`",
      { workdir: "/home/u/repo" },
    );
    const links = fileLinks();
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("C:\\Users\\张三\\下载\\报表.xlsx");
    expect(links[1]).toHaveTextContent("src/我的组件.tsx:8");
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "C:\\Users\\张三\\下载\\报表.xlsx",
      undefined,
      undefined,
    );
    fireEvent.click(links[1]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/home/u/repo/src/我的组件.tsx",
      8,
      8,
    );
  });

  it("keeps a pure-Chinese inline-code sentence as plain code (no false link)", () => {
    const { container, fileLinks } = renderMessage("结果：`请把报表放在这里`");
    expect(fileLinks()).toHaveLength(0);
    const code = container.querySelector(".markdown-content code");
    expect(code?.textContent).toBe("请把报表放在这里");
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

  it("linkifies Chinese-filename absolute paths in prose and opens them verbatim", () => {
    const { onOpenFile, fileLinks } = renderMessage(
      "文件在 C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html，位于下载目录。",
    );
    const links = fileLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(
      "C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html",
    );
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "C:\\Users\\wb.tandefu01\\Downloads\\CodeChat桌.html",
      undefined,
      undefined,
    );
  });

  it("does NOT linkify prose Chinese text or extension-less Chinese absolute paths", () => {
    const { container, fileLinks } = renderMessage(
      "请把报表放在这里 /home/张三/项目 目录下。",
    );
    expect(fileLinks()).toHaveLength(0);
    expect(container.querySelector(".markdown-content")?.textContent).toContain(
      "/home/张三/项目",
    );
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

  it("links a Windows path whose backslash precedes punctuation (markdown escape)", () => {
    // `\.wave` 会被 markdown 当转义序列：反斜杠会被吃掉、文本在标点处被切段。
    const path =
      "C:\\Users\\u\\github\\wave-agent\\.wave\\docs\\public\\x.webp";
    const { container, onOpenFile, fileLinks } = renderMessage(
      `产物在 ${path} 里`,
    );
    const links = fileLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(path);
    // 显示文本里的反斜杠没被 markdown 吞掉
    expect(container.querySelector(".markdown-content")?.textContent).toContain(
      path,
    );
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(path, undefined, undefined);
  });

  it("keeps markdown escapes working outside Windows paths", () => {
    const { container } = renderMessage("\\*不是斜体\\* 的字面星号");
    expect(container.querySelector(".markdown-content em")).toBeNull();
    expect(container.querySelector(".markdown-content")?.textContent).toContain(
      "*不是斜体*",
    );
  });
});

describe("fenced code block paths (specs/ui/file-path-links.md)", () => {
  const winPath = "C:\\Users\\u\\proj\\a.webp";
  const relPath = "docs/public/screenshots/x.webp";

  it("linkifies each path line and preserves newlines/indentation", () => {
    const { container, onOpenFile, fileLinks } = renderMessage(
      `\`\`\`\n    ${winPath}\n  ${relPath}\n\`\`\``,
      { workdir: "/home/u/repo" },
    );
    const links = fileLinks();
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent(winPath);
    expect(links[1]).toHaveTextContent(relPath);
    expect(container.querySelector(".markdown-content pre")?.textContent).toBe(
      `    ${winPath}\n  ${relPath}\n`,
    );
    fireEvent.click(links[1]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/home/u/repo/docs/public/screenshots/x.webp",
      undefined,
      undefined,
    );
  });

  it("linkifies a path inside a code line, leaving quotes as code text", () => {
    const { container, fileLinks } = renderMessage(
      '```\nconst p = "src/utils/a.ts";\n```',
      { workdir: "/home/u/repo" },
    );
    const links = fileLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("src/utils/a.ts");
    expect(container.querySelector(".markdown-content pre")?.textContent).toBe(
      'const p = "src/utils/a.ts";\n',
    );
  });

  it("parses :N-M in a code block path and opens the line range", () => {
    const { onOpenFile, fileLinks } = renderMessage(
      "```\nsrc/utils/format.ts:12-24\n```",
      { workdir: "/home/u/repo" },
    );
    const links = fileLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("src/utils/format.ts:12-24");
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/home/u/repo/src/utils/format.ts",
      12,
      24,
    );
  });

  it("does not linkify non-path code and keeps the language class", () => {
    const { container, fileLinks } = renderMessage(
      "```bash\nnpm run build\nvar x = 1\n```",
    );
    expect(fileLinks()).toHaveLength(0);
    expect(
      container.querySelector(".markdown-content pre code.language-bash")
        ?.textContent,
    ).toBe("npm run build\nvar x = 1\n");
  });

  it("keeps relative code paths plain when there is no workdir", () => {
    const { container, fileLinks } = renderMessage(
      `\`\`\`\n${relPath}\n\`\`\``,
    );
    expect(fileLinks()).toHaveLength(0);
    expect(container.querySelector(".markdown-content pre")?.textContent).toBe(
      `${relPath}\n`,
    );
  });

  it("does not linkify mermaid blocks (rendered as a diagram)", async () => {
    const { container, fileLinks } = renderMessage(
      "```mermaid\ngraph TD\nA-->B\n```",
    );
    expect(fileLinks()).toHaveLength(0);
    // mermaid 块被提前抽成图表，不经过 marked 的 code renderer
    expect(container.querySelector(".markdown-content pre")).toBeNull();
    await vi.waitFor(() =>
      expect(container.querySelector(".mermaid-container svg")).not.toBeNull(),
    );
  });
});

// bash 工具输出（终端风格纯文本，不走 markdown）里的路径链接化，规则与围栏
// 代码块通道一致（specs/ui/file-path-links.md）。
describe("bash output paths (specs/ui/file-path-links.md)", () => {
  const winPath = "C:\\Users\\u\\proj\\dist\\a.js";
  const relPath = "src/utils/format.ts";

  function renderBashOutput(
    result: string,
    options?: { workdir?: string; ide?: boolean },
  ) {
    const vscode = createMockVscode();
    const message = {
      id: "msg-bash-path-1",
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: BASH_TOOL_NAME,
          parameters: JSON.stringify({ command: "pnpm build" }),
          compactParams: "pnpm build",
          stage: "end",
          success: true,
          result,
        },
      ],
    } as unknown as MessageType;
    const onOpenFile = vi.fn();
    const rendered = render(
      <Message
        message={message}
        vscode={vscode}
        workdir={options?.workdir}
        onOpenFile={options?.ide ? undefined : onOpenFile}
      />,
    );
    const output = rendered.container.querySelector(".bash-command-output");
    const pathLinks = () =>
      Array.from(
        rendered.container.querySelectorAll(
          ".bash-command-output a.file-path-link",
        ),
      ) as HTMLElement[];
    return { ...rendered, vscode, output, onOpenFile, pathLinks };
  }

  it("linkifies absolute paths in the output and opens them on click", () => {
    const { output, onOpenFile, pathLinks } = renderBashOutput(
      `built ${winPath}\ndone /home/u/repo/x.ts\n`,
    );
    const links = pathLinks();
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent(winPath);
    expect(links[1]).toHaveTextContent("/home/u/repo/x.ts");
    // 输出文本（含换行）保持原样（工具块的 result 进渲染前会被 trim）
    expect(output?.textContent).toBe(
      `built ${winPath}\ndone /home/u/repo/x.ts`,
    );
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(winPath, undefined, undefined);
  });

  it("joins a relative output path to workdir and passes the line range", () => {
    const { onOpenFile, pathLinks } = renderBashOutput(
      `error at "${relPath}:12-24";`,
      { workdir: "/home/u/repo" },
    );
    const links = pathLinks();
    expect(links).toHaveLength(1);
    // 引号与分号留在链接外
    expect(links[0]).toHaveTextContent(`${relPath}:12-24`);
    fireEvent.click(links[0]!);
    expect(onOpenFile).toHaveBeenCalledWith(
      "/home/u/repo/src/utils/format.ts",
      12,
      24,
    );
  });

  it("IDE host: clicking an output path emits the openFile RPC", () => {
    const { vscode, pathLinks } = renderBashOutput(`wrote ${winPath}`, {
      ide: true,
    });
    fireEvent.click(pathLinks()[0]!);
    const sent = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const openFileMsg = sent.find(
      (m: { command: string }) => m.command === "openFile",
    ) as Record<string, unknown>;
    expect(openFileMsg).toBeDefined();
    expect(openFileMsg.path).toBe(winPath);
  });

  it("keeps both the URL and the path clickable in the same line", () => {
    const { output } = renderBashOutput(
      "see https://example.com/docs or src/a.ts",
      { workdir: "/home/u/repo" },
    );
    const urlLink = output?.querySelector(
      'a[href="https://example.com/docs"]',
    ) as HTMLElement | null;
    expect(urlLink).not.toBeNull();
    const pathLink = output?.querySelector(
      "a.file-path-link",
    ) as HTMLElement | null;
    expect(pathLink?.textContent).toBe("src/a.ts");
  });

  it("keeps relative output paths plain when there is no workdir", () => {
    const { output, pathLinks } = renderBashOutput(`error in ${relPath}`);
    expect(pathLinks()).toHaveLength(0);
    expect(output?.textContent).toBe(`error in ${relPath}`);
  });

  it("keeps non-path output as plain text (logs, API paths, extension-less absolutes)", () => {
    const { output, pathLinks } = renderBashOutput(
      "npm run build\nGET /api/v1/users 200\n/usr/local/bin",
      { workdir: "/home/u/repo" },
    );
    expect(pathLinks()).toHaveLength(0);
    expect(output?.textContent).toBe(
      "npm run build\nGET /api/v1/users 200\n/usr/local/bin",
    );
  });
});
