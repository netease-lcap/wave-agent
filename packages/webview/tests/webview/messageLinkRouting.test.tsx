import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

// in the desktop host, any http(s) link opens the preview pane (spec scenario
// 1); non-http(s) links (mailto:, file:) go to the system default app via
// openExternal (scenario 2). IDE hosts must keep their native link handling
// (no interception at all).

const CONTENT =
  "preview [local app](http://localhost:5173/app) then [docs](https://example.com/docs) then [mail](mailto:dev@example.com)";

function renderMessage(options?: {
  onOpenPreview?: (url: string) => void;
  hostType?: string;
  content?: string;
}) {
  const vscode = createMockVscode();
  if (options?.hostType) {
    window.waveHostType = options.hostType;
  }
  const message = MockDataGenerator.createAssistantMessage(
    options?.content ?? CONTENT,
  );
  const result = render(
    <Message
      message={message}
      vscode={vscode}
      onOpenPreview={options?.onOpenPreview}
    />,
  );
  const links = result.container.querySelectorAll(
    ".message-content-container a",
  );
  return {
    ...result,
    vscode,
    localLink: links[0] as HTMLElement,
    externalLink: links[1] as HTMLElement,
    mailLink: links[2] as HTMLElement,
  };
}

afterEach(() => {
  delete window.waveHostType;
});

describe("Message link routing", () => {
  it("desktop host: localhost link opens the preview pane", () => {
    const onOpenPreview = vi.fn();
    const { vscode, localLink } = renderMessage({
      onOpenPreview,
      hostType: "desktop",
    });

    const notPrevented = fireEvent.click(localLink);

    expect(onOpenPreview).toHaveBeenCalledWith("http://localhost:5173/app");
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false); // default navigation prevented
  });

  it("desktop host: non-localhost http(s) link opens the preview pane", () => {
    const onOpenPreview = vi.fn();
    const { vscode, externalLink } = renderMessage({
      onOpenPreview,
      hostType: "desktop",
    });

    const notPrevented = fireEvent.click(externalLink);

    expect(onOpenPreview).toHaveBeenCalledWith("https://example.com/docs");
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false); // default navigation prevented
  });

  it("desktop host: non-http(s) link goes to the system default app", () => {
    const onOpenPreview = vi.fn();
    const { vscode, mailLink } = renderMessage({
      onOpenPreview,
      hostType: "desktop",
    });

    fireEvent.click(mailLink);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "mailto:dev@example.com",
    });
  });

  it("desktop host without onOpenPreview: localhost link falls back to external browser", () => {
    const { vscode, localLink } = renderMessage({ hostType: "desktop" });

    fireEvent.click(localLink);

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "http://localhost:5173/app",
    });
  });

  it("IDE host: links are not intercepted at all", () => {
    const onOpenPreview = vi.fn();
    // jsdom only implements same-document (fragment) navigation; clicking
    // real URLs would trigger its unimplemented cross-document navigation.
    const { vscode, localLink, externalLink } = renderMessage({
      onOpenPreview,
      content: "preview [local app](#app) then [docs](#docs)",
    });

    const localNotPrevented = fireEvent.click(localLink);
    const externalNotPrevented = fireEvent.click(externalLink);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(localNotPrevented).toBe(true); // default navigation preserved
    expect(externalNotPrevented).toBe(true);
  });

  it("desktop host: clicking non-link content does nothing", () => {
    const onOpenPreview = vi.fn();
    const { container, vscode } = renderMessage({
      onOpenPreview,
      hostType: "desktop",
    });
    const paragraph = container.querySelector(".message-content-container p")!;

    fireEvent.click(paragraph);

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });
});
