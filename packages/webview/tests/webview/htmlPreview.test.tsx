import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { prunePanelGroupCache } from "../../src/components/ChatApp";
import { WRITE_TOOL_NAME } from "wave-agent-sdk";
import {
  createMockVscode,
  renderChatApp,
  sendCommand,
  sendHostMessage,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import { MockDataGenerator } from "../fixtures/mockData";
import type { Message } from "wave-agent-sdk";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/**
 * Local .html path → preview tab (spec: docs/specs/desktop/desktop-preview.md
 * 「本地 HTML 文件预览」). The webview routes .html/.htm clicks to the
 * desktopPreviewFile command, fills the placeholder tab from the
 * desktopPreviewFileResult reply (keyed by requestId), falls back to the file
 * panel on error, releases the server reference on tab close, and re-acquires
 * on write/edit completion (auto-reload).
 */

function renderDesktop(options?: { workdir?: string }) {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({
      workdir: options?.workdir,
      recentWorkdirs: options?.workdir ? [options.workdir] : [],
    }),
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

/** Assistant message whose markdown mentions a local path → a clickable link. */
function messageWithPath(path: string): Message {
  return MockDataGenerator.createAssistantMessage(`页面在 \`${path}\``);
}

function clickPathLink(path: string) {
  const link = screen
    .getAllByText(path, { exact: false })
    .find((el) => el.closest("a.file-path-link")) as HTMLElement | undefined;
  expect(link).toBeDefined();
  fireEvent.click(link!);
}

const previewRequests = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "desktopPreviewFile");

const releasePosts = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "desktopPreviewFileRelease");

const openFilePosts = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "openFile");

/** Reply to a desktopPreviewFile request with a URL. */
function replyPreviewUrl(requestId: string, url: string) {
  sendHostMessage({
    command: "desktopPreviewFileResult",
    requestId,
    url,
  } as never);
}

/** Reply to a desktopPreviewFile request with an error. */
function replyPreviewError(requestId: string, error: string) {
  sendHostMessage({
    command: "desktopPreviewFileResult",
    requestId,
    error,
  } as never);
}

beforeEach(() => {
  prunePanelGroupCache(new Set());
});

afterEach(() => {
  delete window.waveHostType;
});

describe("ChatApp local .html preview routing", () => {
  it("IDE hosts keep the plain openFile RPC for .html paths (spec 场景 9)", () => {
    // No window.waveHostType → IDE webview shape (renderChatApp, not DesktopApp).
    const vscode = createMockVscode();
    renderChatApp(vscode);
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/report.html")]),
    );
    clickPathLink("/work/a/report.html");

    expect(previewRequests(vscode)).toHaveLength(0);
    expect(releasePosts(vscode)).toHaveLength(0);
    const opens = openFilePosts(vscode);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ path: "/work/a/report.html" });
  });

  it("a .html path click opens a preview tab and requests a re-hosted URL (spec 场景 1)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/report.html")]),
    );

    clickPathLink("/work/a/report.html");

    // Exactly one re-hosting request, keyed by requestId.
    const requests = previewRequests(vscode);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "/work/a/report.html" });
    expect(typeof requests[0].requestId).toBe("string");

    // The preview tab exists (blank until the reply lands).
    expect(screen.getByTestId("panel-tab-preview-1")).toBeInTheDocument();

    // Host reply fills the tab with the loopback URL.
    act(() =>
      replyPreviewUrl(
        requests[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );
    const wv = document.querySelector("webview") as unknown as Element;
    expect(wv).not.toBeNull();
    expect(wv.getAttribute("src")).toBe("http://127.0.0.1:45000/report.html");
  });

  it("the placeholder tab shows the filename as its title until the page reports one (spec 场景 7)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/report.html")]),
    );
    clickPathLink("/work/a/report.html");

    expect(screen.getByTestId("panel-tab-preview-1")).toHaveTextContent(
      "report.html",
    );

    // Once the page reports a <title>, the tab follows it.
    const requests = previewRequests(vscode);
    act(() =>
      replyPreviewUrl(
        requests[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );
    const wv = document.querySelector("webview") as unknown as Element;
    fireEvent(
      wv,
      Object.assign(new Event("page-title-updated"), { title: "月度报表" }),
    );
    expect(screen.getByTestId("panel-tab-preview-1")).toHaveTextContent(
      "月度报表",
    );
  });

  it("clicking the same file again activates the existing tab and re-requests, no second tab (spec 场景 2)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/report.html")]),
    );
    clickPathLink("/work/a/report.html");
    const first = previewRequests(vscode)[0];
    act(() =>
      replyPreviewUrl(
        first.requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );
    const firstWv = document.querySelector("webview");

    clickPathLink("/work/a/report.html");

    // Second request for the same path, but still exactly one preview tab.
    const requests = previewRequests(vscode);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ path: "/work/a/report.html" });
    expect(screen.getAllByTestId(/^panel-tab-preview-/)).toHaveLength(1);

    // Same URL replied → epoch bump REMOUNTS the pane (a fresh <webview> node
    // whose mount effect re-sets src — the only way a same-URL reload works).
    act(() =>
      replyPreviewUrl(
        requests[1].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );
    const secondWv = document.querySelector("webview");
    expect(secondWv).not.toBeNull();
    expect(secondWv).not.toBe(firstWv);
    expect(secondWv!.getAttribute("src")).toBe(
      "http://127.0.0.1:45000/report.html",
    );
  });

  it("a different .html opens a second preview tab (multi-instance, spec 场景 2)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([
        messageWithPath("/work/a/report.html"),
        messageWithPath("/work/a/other.html"),
      ]),
    );
    clickPathLink("/work/a/report.html");
    act(() =>
      replyPreviewUrl(
        previewRequests(vscode)[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );

    clickPathLink("/work/a/other.html");

    expect(screen.getByTestId("panel-tab-preview-1")).toBeInTheDocument();
    expect(screen.getByTestId("panel-tab-preview-2")).toBeInTheDocument();
    expect(previewRequests(vscode)).toHaveLength(2);
  });

  it("a .htm path also previews; .svg and plain files keep the file-panel route", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([
        messageWithPath("/work/a/page.htm"),
        messageWithPath("/work/a/logo.svg"),
        messageWithPath("/work/a/src.ts"),
      ]),
    );

    clickPathLink("/work/a/page.htm");
    expect(previewRequests(vscode)).toHaveLength(1);
    expect(openFilePosts(vscode)).toHaveLength(0);

    clickPathLink("/work/a/logo.svg");
    expect(previewRequests(vscode)).toHaveLength(1); // unchanged
    expect(openFilePosts(vscode)).toHaveLength(1);
    expect(openFilePosts(vscode)[0]).toMatchObject({
      path: "/work/a/logo.svg",
    });

    clickPathLink("/work/a/src.ts");
    expect(previewRequests(vscode)).toHaveLength(1);
    expect(openFilePosts(vscode)).toHaveLength(2);
  });

  it("an error reply closes the placeholder tab and falls back to the file panel (spec 场景 4)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/gone.html")]),
    );
    clickPathLink("/work/a/gone.html");

    const requests = previewRequests(vscode);
    expect(requests).toHaveLength(1);

    act(() =>
      replyPreviewError(
        requests[0].requestId as string,
        "文件不存在：/work/a/gone.html",
      ),
    );

    // The placeholder preview tab is gone…
    expect(screen.queryByTestId("panel-tab-preview-1")).not.toBeInTheDocument();
    // …and the file panel's open flow took over (file tab + read request).
    expect(screen.getByTestId("panel-tab-file-1")).toBeInTheDocument();
    const opens = openFilePosts(vscode);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      path: "/work/a/gone.html",
      host: "local",
    });
  });

  it("closing the preview tab releases the server reference with the path (spec 场景 8)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/report.html")]),
    );
    clickPathLink("/work/a/report.html");
    act(() =>
      replyPreviewUrl(
        previewRequests(vscode)[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );

    fireEvent.click(screen.getByTestId("panel-tab-close-preview-1"));

    const releases = releasePosts(vscode);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ path: "/work/a/report.html" });
  });

  it("closing the tab while the acquire is in flight releases the late-arriving reference", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    sendHostMessage(
      fixtures.updateMessages([messageWithPath("/work/a/report.html")]),
    );
    clickPathLink("/work/a/report.html");
    const requests = previewRequests(vscode);
    expect(requests).toHaveLength(1);

    // Close before the host replies: the close itself releases (covers the
    // already-acquired case); the host-side no-op for a not-yet-registered
    // ref is harmless.
    fireEvent.click(screen.getByTestId("panel-tab-close-preview-1"));
    expect(releasePosts(vscode)).toHaveLength(1);

    // The late success reply must not resurrect the tab — it releases again
    // (a no-op if the close-time release already dropped the ref).
    act(() =>
      replyPreviewUrl(
        requests[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );
    expect(screen.queryByTestId("panel-tab-preview-1")).not.toBeInTheDocument();
    const releases = releasePosts(vscode);
    expect(releases).toHaveLength(2);
    expect(releases[1]).toMatchObject({ path: "/work/a/report.html" });
  });

  it("a successful Write on the previewed file re-requests its URL (auto-reload, spec 场景 5)", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    const toolBlock = {
      id: "t1",
      name: WRITE_TOOL_NAME,
      stage: "streaming" as const,
      parameters: JSON.stringify({ file_path: "/work/a/report.html" }),
    };
    // One message list carrying BOTH the in-flight Write block and the path
    // mention (updateMessages replaces the whole list, so the block must ride
    // along or the later updateToolBlock finds nothing to complete).
    const toolMessage = {
      id: "m1",
      role: "assistant" as const,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "tool" as const, ...toolBlock }],
    };
    sendHostMessage(
      fixtures.setInitialState({
        messages: [toolMessage, messageWithPath("/work/a/report.html")],
        workdir: "/work/a",
      }),
    );

    clickPathLink("/work/a/report.html");
    act(() =>
      replyPreviewUrl(
        previewRequests(vscode)[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );
    expect(previewRequests(vscode)).toHaveLength(1);

    // The Write completes → the preview tab re-acquires.
    sendCommand("updateToolBlock", {
      params: { messageId: "m1", ...toolBlock, stage: "end", success: true },
    });

    const requests = previewRequests(vscode);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ path: "/work/a/report.html" });
  });

  it("a Write on a different file does not reload the preview", () => {
    window.waveHostType = "desktop";
    const { vscode } = renderDesktop({ workdir: "/work/a" });
    const toolBlock = {
      id: "t1",
      name: WRITE_TOOL_NAME,
      stage: "streaming" as const,
      parameters: JSON.stringify({ file_path: "/work/a/style.css" }),
    };
    const toolMessage = {
      id: "m1",
      role: "assistant" as const,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "tool" as const, ...toolBlock }],
    };
    sendHostMessage(
      fixtures.setInitialState({
        messages: [toolMessage, messageWithPath("/work/a/report.html")],
        workdir: "/work/a",
      }),
    );
    clickPathLink("/work/a/report.html");
    act(() =>
      replyPreviewUrl(
        previewRequests(vscode)[0].requestId as string,
        "http://127.0.0.1:45000/report.html",
      ),
    );

    sendCommand("updateToolBlock", {
      params: { messageId: "m1", ...toolBlock, stage: "end", success: true },
    });

    expect(previewRequests(vscode)).toHaveLength(1); // no re-acquire
  });
});
