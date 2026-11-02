import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { SingleFilePane } from "./filePaneHarness";
import type { FileViewState } from "../../src/types";

/**
 * Links inside a rendered markdown file (spec「文件面板 · markdown 链接」).
 *
 * The panel renders markdown into the app document, so an untouched click is a
 * navigation of the whole window — the bug: `[spec](020-mini-app/spec.md)` in
 * `docs/specs/index.md` tried to load `app.asar/webview/020-mini-app/spec.md`
 * and replaced the UI with an error page. Local links must open in the panel,
 * resolved against the file being read.
 */
const makeMarkdownView = (
  overrides: Partial<FileViewState> = {},
): FileViewState => ({
  path: "/repo/docs/specs/index.md",
  host: "local",
  content: [
    "# 规格",
    "",
    "- [mini app](020-mini-app/spec.md)",
    "- [相对](../core/x.md)",
    "- [外链](https://example.com/docs)",
    "- [锚点](#规格)",
  ].join("\n"),
  ...overrides,
});

/**
 * Dispatch a real, cancelable click and report whether the panel prevented the
 * default. `fireEvent` hands back the dispatcher's boolean rather than the
 * event, and the two document listeners here run *after* React's delegated
 * handler: the first records the panel's own choice, the second cancels the
 * default so jsdom does not attempt a navigation it cannot perform (its "Not
 * implemented: navigation" notice would otherwise be the loudest line in a
 * green run).
 */
const clickLink = (text: string): boolean => {
  let preventedByPanel = false;
  const record = (event: Event) => {
    preventedByPanel = event.defaultPrevented;
  };
  const silence = (event: Event) => event.preventDefault();
  document.addEventListener("click", record);
  document.addEventListener("click", silence);
  screen
    .getByText(text)
    .dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  document.removeEventListener("click", record);
  document.removeEventListener("click", silence);
  return preventedByPanel;
};

function renderPane(onOpenFileInPanel = vi.fn()) {
  render(
    <SingleFilePane
      fileView={makeMarkdownView()}
      width={420}
      onOpenFileInPanel={onOpenFileInPanel}
    />,
  );
  return onOpenFileInPanel;
}

describe("FilePane markdown links", () => {
  it("opens a relative link in the panel, resolved against the open file", () => {
    const onOpenFileInPanel = renderPane();

    expect(clickLink("mini app")).toBe(true);
    expect(onOpenFileInPanel).toHaveBeenCalledWith(
      "/repo/docs/specs/020-mini-app/spec.md",
    );
  });

  it("resolves `../` against the open file's directory", () => {
    const onOpenFileInPanel = renderPane();

    clickLink("相对");
    expect(onOpenFileInPanel).toHaveBeenCalledWith("/repo/docs/core/x.md");
  });

  it("leaves an external link to its own handler", () => {
    const onOpenFileInPanel = renderPane();

    expect(clickLink("外链")).toBe(false);
    expect(onOpenFileInPanel).not.toHaveBeenCalled();
  });

  it("leaves an in-page anchor alone", () => {
    const onOpenFileInPanel = renderPane();

    expect(clickLink("锚点")).toBe(false);
    expect(onOpenFileInPanel).not.toHaveBeenCalled();
  });
});
