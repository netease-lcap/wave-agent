import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  fireEvent,
  screen,
  act,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { FilePane } from "../../src/components/FilePane";
import type { FileItem, FileViewState, VsCodeApi } from "../../src/types";

function makeFileView(overrides: Partial<FileViewState> = {}): FileViewState {
  return {
    path: "/work/a/src/app.ts",
    host: "local",
    content: "const a = 1;\nconst b = 2;\n",
    ...overrides,
  };
}

function makeFileItem(
  name: string,
  path: string,
  relativePath: string,
  isDirectory = false,
): FileItem {
  const extensionMatch = name.match(/\.([^.]+)$/);
  return {
    path,
    relativePath,
    name,
    extension: extensionMatch ? extensionMatch[1] : "",
    icon: isDirectory ? "codicon-folder" : "codicon-file",
    isDirectory,
  };
}

function makeVscode() {
  return {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  };
}

/** Simulate the host's broadcast reply to a requestFileSuggestions request. */
function sendSuggestionsResponse(requestId: string, suggestions: FileItem[]) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "fileSuggestionsResponse",
          suggestions,
          filterText: "",
          requestId,
        },
      }),
    );
  });
}

function sendSuggestionsError(requestId: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { command: "fileSuggestionsError", error: "boom", requestId },
      }),
    );
  });
}

/** Wait for the (debounced) requestFileSuggestions post and return its id. */
async function waitForSearchRequest(
  vscode: ReturnType<typeof makeVscode>,
  filterText: string,
): Promise<string> {
  await waitFor(
    () => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "requestFileSuggestions",
          filterText,
        }),
      );
    },
    { timeout: 3000 },
  );
  const calls = vscode.postMessage.mock.calls.map((c) => c[0]);
  const call = calls
    .filter(
      (c) =>
        c.command === "requestFileSuggestions" && c.filterText === filterText,
    )
    .pop();
  return call.requestId as string;
}

function renderPane(
  options: {
    fileView?: FileViewState | null;
    width?: number;
    maxWidth?: number;
    workdir?: string;
    onOpenExternal?: (path: string) => void;
    onClose?: () => void;
    onWidthChange?: (width: number) => void;
    vscode?: VsCodeApi;
    onOpenFileInPanel?: (path: string) => void;
  } = {},
) {
  const onClose = options.onClose ?? vi.fn();
  const onWidthChange = options.onWidthChange ?? vi.fn();
  const fileView =
    options.fileView === undefined ? makeFileView() : options.fileView;
  const props = {
    fileView,
    width: options.width ?? 420,
    onWidthChange,
    maxWidth: options.maxWidth ?? 716,
    onClose,
    onOpenExternal: options.onOpenExternal,
    workdir: options.workdir,
    vscode: options.vscode,
    onOpenFileInPanel: options.onOpenFileInPanel,
  };
  const result = render(<FilePane {...props} />);
  const rerenderWith = (next: FileViewState | null) =>
    result.rerender(<FilePane {...props} fileView={next} />);
  return { ...result, rerenderWith, onClose, onWidthChange };
}

describe("FilePane", () => {
  it("shows the placeholder when no file is open", () => {
    renderPane({ fileView: null });
    expect(
      screen.getByText("点击消息中的文件路径，在此查看文件内容"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("file-open-external")).not.toBeInTheDocument();
  });

  it("keeps the 文件 title and right-aligned close button in the empty state", () => {
    renderPane({ fileView: null });
    const toolbar = screen
      .getByTestId("file-pane")
      .querySelector(".preview-pane-toolbar");
    expect(toolbar?.querySelector(".preview-pane-url")?.textContent).toBe(
      "文件",
    );
    const close = screen.getByTestId("file-close");
    expect(
      close.compareDocumentPosition(
        toolbar!.querySelector(".preview-pane-url") as Node,
      ),
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(
      screen.queryByText(/本地|^prod$/, { selector: ".file-pane-host" }),
    ).not.toBeInTheDocument();
  });

  it("shows the host badge and path in the toolbar", () => {
    renderPane({ workdir: "/work/a" });
    const toolbar = screen
      .getByTestId("file-pane")
      .querySelector(".preview-pane-toolbar");
    expect(toolbar?.querySelector(".file-pane-host")?.textContent).toBe("本地");
    expect(toolbar?.querySelector(".file-pane-path")?.textContent).toBe(
      "src/app.ts",
    );
    expect(screen.queryByText("文件")).not.toBeInTheDocument();
  });

  it("trims over-long paths with a middle ellipsis, keeping the file name", () => {
    const long = `/repos/wave-agent/${"x".repeat(60)}/src/components/FilePane.tsx`;
    renderPane({ fileView: makeFileView({ path: long }) });
    const el = screen.getByTitle(long);
    expect(el.textContent).not.toBe(long);
    expect(el.textContent).toContain("…");
    expect(el.textContent?.endsWith("FilePane.tsx")).toBe(true);
  });

  it("shows the error state instead of content", () => {
    renderPane({
      fileView: {
        path: "/work/a/nope.ts",
        host: "local",
        error: "文件不存在：/work/a/nope.ts",
      },
    });
    expect(screen.getByText("文件不存在：/work/a/nope.ts")).toBeInTheDocument();
    expect(screen.queryByText("正在读取文件…")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("file-pane").length).toBe(1);
  });

  it("shows a loading state while the host reads the file", () => {
    renderPane({
      fileView: { path: "/work/a/src/app.ts", host: "local", loading: true },
    });
    expect(screen.getByText("正在读取文件…")).toBeInTheDocument();
  });

  it("renders an inlined base64 image for image files", () => {
    renderPane({
      workdir: "/work/a",
      fileView: {
        path: "/work/a/img/pic.png",
        host: "prod",
        imageBase64: "data:image/png;base64,AAAA",
      },
    });
    const img = screen.getByAltText("img/pic.png");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(screen.queryByText("正在读取文件…")).not.toBeInTheDocument();
  });

  it("renders markdown content for .md files", () => {
    const { container } = renderPane({
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "# 标题\n\n正文 **加粗**",
      },
    });
    const md = container.querySelector(".file-pane-markdown");
    expect(md).not.toBeNull();
    expect(md?.querySelector("h1")?.textContent).toBe("标题");
    expect(md?.querySelector("p strong")?.textContent).toBe("加粗");
  });

  it("syntax-highlights fenced code blocks inside markdown", () => {
    const { container } = renderPane({
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "```ts\nconst x = 1;\n```",
      },
    });
    const code = container.querySelector(
      ".file-pane-markdown pre code.language-ts",
    );
    expect(code).not.toBeNull();
    expect(code?.querySelector("span.hljs-keyword")).not.toBeNull();
  });

  it("renders code files as numbered lines", () => {
    const { container } = renderPane();
    const lines = container.querySelectorAll(".file-pane-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector(".file-pane-line-no")?.textContent).toBe("1");
    expect(
      lines[0].querySelector(".file-pane-line-code")?.textContent,
    ).toContain("const a = 1");
    expect(lines[1].querySelector(".file-pane-line-no")?.textContent).toBe("2");
    expect(
      lines[1].querySelector(".file-pane-line-code")?.textContent,
    ).toContain("const b = 2");
  });

  it("syntax-highlights code lines with hljs spans", () => {
    const { container } = renderPane();
    expect(
      container.querySelector(".file-pane-line-code span.hljs-keyword"),
    ).not.toBeNull();
  });

  it("marks the requested line range as active", () => {
    const { container } = renderPane({
      fileView: makeFileView({ startLine: 1, endLine: 1 }),
    });
    const lines = container.querySelectorAll(".file-pane-line");
    expect(lines[0].classList.contains("file-pane-line--active")).toBe(true);
    expect(lines[1].classList.contains("file-pane-line--active")).toBe(false);
  });

  it("marks every line from startLine on when endLine is absent", () => {
    const { container } = renderPane({
      fileView: makeFileView({ startLine: 2 }),
    });
    const lines = container.querySelectorAll(".file-pane-line");
    expect(lines[0].classList.contains("file-pane-line--active")).toBe(false);
    expect(lines[1].classList.contains("file-pane-line--active")).toBe(true);
  });

  it("scrolls to the start line when the opener carries one", () => {
    const content =
      Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    renderPane({ fileView: makeFileView({ content, startLine: 56 }) });
    const body = document.querySelector(".file-pane-body") as HTMLElement;
    // (56 - 1) * 20 - 20 * 1.5 → the requested line lands ~1.5 lines from the top.
    expect(body.scrollTop).toBe(1070);
  });

  it("shows the total-lines truncated hint", () => {
    const content =
      Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const { container } = renderPane({
      fileView: makeFileView({ content, truncated: true, totalLines: 2001 }),
    });
    expect(
      container.querySelector(".file-pane-truncated-hint")?.textContent,
    ).toBe("文件共 2001 行，仅显示前 2000 行");
  });

  it("shows the generic truncated hint when total lines are unknown", () => {
    const { container } = renderPane({
      fileView: makeFileView({ truncated: true }),
    });
    expect(
      container.querySelector(".file-pane-truncated-hint")?.textContent,
    ).toBe("文件较大，内容已截断");
  });

  it("shows 本地 for local files and the host name for remote ones", () => {
    const { rerenderWith } = renderPane({
      fileView: makeFileView({ host: "local" }),
    });
    expect(screen.getByText("本地")).toBeInTheDocument();
    rerenderWith(makeFileView({ host: "prod" }));
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.queryByText("本地")).not.toBeInTheDocument();
  });

  it("shows the workdir-relative path with the full path as title", () => {
    renderPane({ workdir: "/work/a" });
    const path = screen.getByText("src/app.ts");
    expect(path.getAttribute("title")).toBe("/work/a/src/app.ts");
  });

  it("shows the full path when it is not under the workdir", () => {
    renderPane({ workdir: "/other" });
    expect(screen.getByText("/work/a/src/app.ts")).toBeInTheDocument();
  });

  it("opens the file in the OS default app for local sessions", () => {
    const onOpenExternal = vi.fn();
    renderPane({ onOpenExternal });
    fireEvent.click(screen.getByTestId("file-open-external"));
    expect(onOpenExternal).toHaveBeenCalledWith("/work/a/src/app.ts");
  });

  it("hides the external-open button for remote files", () => {
    const onOpenExternal = vi.fn();
    renderPane({ fileView: makeFileView({ host: "prod" }), onOpenExternal });
    expect(screen.queryByTestId("file-open-external")).not.toBeInTheDocument();
  });

  it("hides the external-open button when no handler is wired", () => {
    renderPane({ onOpenExternal: undefined });
    expect(screen.queryByTestId("file-open-external")).not.toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    const { onClose } = renderPane();
    fireEvent.click(screen.getByTestId("file-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("drag handle resizes within min/max bounds", () => {
    const { onWidthChange } = renderPane({ maxWidth: 716 });
    const pane = screen.getByTestId("file-pane");
    const handle = pane.querySelector(
      ".preview-pane-drag-handle",
    ) as HTMLElement;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 1024,
    } as DOMRect);

    fireEvent.mouseDown(handle);
    expect(handle.style.background).not.toBe("");
    expect(document.body.classList.contains("is-panel-resizing")).toBe(true);
    fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    expect(handle.style.background).not.toBe(""); // still lit mid-drag
    fireEvent.mouseMove(window, { clientX: 950 }); // 74 → clamped to 320
    expect(onWidthChange).toHaveBeenLastCalledWith(320);
    fireEvent.mouseMove(window, { clientX: 10 }); // 1014 → clamped to 716
    expect(onWidthChange).toHaveBeenLastCalledWith(716);
    fireEvent.mouseUp(window);
    expect(handle.style.background).toBe("");
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);
  });

  describe("FilePane search bar", () => {
    it("hides the search bar without a host bridge", () => {
      renderPane({});
      expect(
        screen.queryByTestId("file-pane-search-input"),
      ).not.toBeInTheDocument();
    });

    it("shows the search bar when a host bridge is provided", () => {
      renderPane({ vscode: makeVscode() });
      expect(screen.getByTestId("file-pane-search-input")).toBeInTheDocument();
    });

    it("requests suggestions with an empty filter on focus", async () => {
      const vscode = makeVscode();
      renderPane({ vscode });
      fireEvent.focus(screen.getByTestId("file-pane-search-input"));
      await waitFor(() =>
        expect(vscode.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            command: "requestFileSuggestions",
            filterText: "",
          }),
        ),
      );
    });

    it("debounces typing and applies only the matching response", async () => {
      const vscode = makeVscode();
      renderPane({ vscode });
      const input = screen.getByTestId("file-pane-search-input");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "app" } });
      const reqId = await waitForSearchRequest(vscode, "app");

      // A stale response (from an older request) must not populate the dropdown.
      sendSuggestionsResponse("stale-request-id", [
        makeFileItem("Stale.tsx", "/work/a/src/Stale.tsx", "src/Stale.tsx"),
      ]);
      expect(screen.queryByText("Stale.tsx")).not.toBeInTheDocument();

      sendSuggestionsResponse(reqId, [
        makeFileItem("App.tsx", "/work/a/src/App.tsx", "src/App.tsx"),
      ]);
      // The name is split by the highlight <span>; the path row is plain text.
      expect(await screen.findByText("src/App.tsx")).toBeInTheDocument();
    });

    it("opens the selected file via keyboard (ArrowDown + Enter)", async () => {
      const vscode = makeVscode();
      const onOpenFileInPanel = vi.fn();
      renderPane({ vscode, onOpenFileInPanel });
      const input = screen.getByTestId("file-pane-search-input");
      fireEvent.focus(input);
      const reqId = await waitForSearchRequest(vscode, "");
      sendSuggestionsResponse(reqId, [
        makeFileItem("A.tsx", "/work/a/src/A.tsx", "src/A.tsx"),
        makeFileItem("B.tsx", "/work/a/src/B.tsx", "src/B.tsx"),
      ]);
      await screen.findByText("A.tsx");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onOpenFileInPanel).toHaveBeenCalledWith("/work/a/src/B.tsx");
      expect(input).toHaveValue("");
    });

    it("opens the file when a suggestion is clicked", async () => {
      const vscode = makeVscode();
      const onOpenFileInPanel = vi.fn();
      renderPane({ vscode, onOpenFileInPanel });
      const input = screen.getByTestId("file-pane-search-input");
      fireEvent.focus(input);
      const reqId = await waitForSearchRequest(vscode, "");
      sendSuggestionsResponse(reqId, [
        makeFileItem("App.tsx", "/work/a/src/App.tsx", "src/App.tsx"),
      ]);
      const item = await screen.findByText("App.tsx");
      fireEvent.click(item);
      expect(onOpenFileInPanel).toHaveBeenCalledWith("/work/a/src/App.tsx");
      expect(input).toHaveValue("");
    });

    it("closes the dropdown and clears the search on Escape", async () => {
      const vscode = makeVscode();
      renderPane({ vscode });
      const input = screen.getByTestId("file-pane-search-input");
      fireEvent.focus(input);
      const reqId = await waitForSearchRequest(vscode, "");
      sendSuggestionsResponse(reqId, [
        makeFileItem("App.tsx", "/work/a/src/App.tsx", "src/App.tsx"),
      ]);
      await screen.findByText("App.tsx");

      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByText("App.tsx")).not.toBeInTheDocument();
      expect(input).toHaveValue("");
    });

    it("filters directory suggestions out of the dropdown", async () => {
      const vscode = makeVscode();
      renderPane({ vscode });
      const input = screen.getByTestId("file-pane-search-input");
      fireEvent.focus(input);
      const reqId = await waitForSearchRequest(vscode, "");
      sendSuggestionsResponse(reqId, [
        makeFileItem(
          "components",
          "/work/a/src/components",
          "src/components",
          true,
        ),
        makeFileItem("App.tsx", "/work/a/src/App.tsx", "src/App.tsx"),
      ]);
      await screen.findByText("App.tsx");
      expect(screen.queryByText("components")).not.toBeInTheDocument();
    });

    it("shows a loading state in flight and clears it on error", async () => {
      const vscode = makeVscode();
      renderPane({ vscode });
      const input = screen.getByTestId("file-pane-search-input");
      fireEvent.focus(input);
      const reqId = await waitForSearchRequest(vscode, "");
      expect(screen.getByText("正在搜索文件...")).toBeInTheDocument();

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      sendSuggestionsError(reqId);
      expect(screen.queryByText("正在搜索文件...")).not.toBeInTheDocument();
      errorSpy.mockRestore();
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    vi.restoreAllMocks();
  });
});
