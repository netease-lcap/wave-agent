import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  DEFAULT_CASE_KEY,
  NoCaseNotice,
  SelectionBadges,
  caseKeysFromModules,
  resolveInitialCase,
} from "../../prototype/caseSelection";

/**
 * 原型预览的 mock 用例选择（packages/webview/prototype）。
 *
 * 背景：用例 key 记在 sessionStorage（按 origin+会话隔离）。分享出去的 artifact、
 * 以及被宿主当成一个全新页面加载的 guest（desktop 预览面板）都读不到上次的选择，
 * 每次都要重走一遍回退链。回退链一旦静默落到空结果（`mock/` 还没建、上次选的用例
 * 文件被删），页面就停在「一条宿主消息都没有」的空白态——看起来就是黑屏。
 * 这些用例钉住三件事：记住的选择要校验、兜底选中要能被说出来、什么都没选到时不
 * 能是一片黑。
 */

describe("prototype mock case selection", () => {
  it("maps the eager mock glob to case keys, ignoring non-.ts files", () => {
    expect(
      caseKeysFromModules({
        "./mock/desktop-new-chat.ts": {},
        "./mock/artifacts-full.ts": {},
        "./mock/README.md": {},
      }),
    ).toEqual(["desktop-new-chat", "artifacts-full"]);
    expect(caseKeysFromModules({})).toEqual([]);
  });

  it("keeps the remembered case when that mock file still exists", () => {
    expect(
      resolveInitialCase(
        [DEFAULT_CASE_KEY, "artifacts-full"],
        "artifacts-full",
      ),
    ).toEqual({
      key: "artifacts-full",
      fallback: false,
      staleSelection: false,
    });
  });

  it("re-selects when the remembered case's mock file is gone (no silent blank page)", () => {
    // sessionStorage 记着 last-used.ts，但那个 mock 文件被删/改名了。
    expect(resolveInitialCase([DEFAULT_CASE_KEY], "last-used")).toEqual({
      key: DEFAULT_CASE_KEY,
      fallback: false,
      staleSelection: true,
    });
  });

  it("prefers the default case when nothing is remembered", () => {
    expect(resolveInitialCase([DEFAULT_CASE_KEY, "other"], null)).toEqual({
      key: DEFAULT_CASE_KEY,
      fallback: false,
      staleSelection: false,
    });
  });

  it("flags the first mock as a fallback pick when the default case is missing", () => {
    expect(resolveInitialCase(["artifacts-full", "other"], null)).toEqual({
      key: "artifacts-full",
      fallback: true,
      staleSelection: false,
    });
  });

  it("reports an empty result when there is no mock file at all", () => {
    expect(resolveInitialCase([], null)).toEqual({
      key: "",
      fallback: false,
      staleSelection: false,
    });
    // 记住的用例 + 空 mock 目录：同样是「选不到」，不是「用户选了无 mock」。
    expect(resolveInitialCase([], "last-used")).toEqual({
      key: "",
      fallback: false,
      staleSelection: true,
    });
  });

  it("treats a remembered 无-mock pick as no memory (it is not a stale case)", () => {
    expect(resolveInitialCase([DEFAULT_CASE_KEY], "")).toEqual({
      key: DEFAULT_CASE_KEY,
      fallback: false,
      staleSelection: false,
    });
  });

  it("explains itself instead of rendering a blank page when there is no case", () => {
    render(<NoCaseNotice />);
    // 人能看懂：说清「没有用例」，并指出 mock/ 这个具体去处。
    expect(screen.getByTestId("preview-no-case")).toHaveTextContent(
      "未找到可用用例",
    );
    expect(screen.getByTestId("preview-no-case")).toHaveTextContent(
      "prototype/mock",
    );
  });

  it("surfaces a fallback pick and a stale memory in the toolbar", () => {
    const { rerender } = render(
      <SelectionBadges
        selection={resolveInitialCase(["artifacts-full"], null)}
      />,
    );
    // 兜底选中必须标出来，否则排查时会被当成用户自己选的。
    expect(screen.getByTestId("preview-case-fallback")).toHaveTextContent(
      "兜底选中",
    );
    expect(screen.queryByTestId("preview-case-stale")).toBeNull();
    expect(screen.queryByTestId("preview-case-missing")).toBeNull();

    rerender(
      <SelectionBadges
        selection={resolveInitialCase([DEFAULT_CASE_KEY], "last-used")}
      />,
    );
    expect(screen.getByTestId("preview-case-stale")).toHaveTextContent(
      "上次的用例已失效",
    );
    expect(screen.queryByTestId("preview-case-fallback")).toBeNull();

    rerender(<SelectionBadges selection={resolveInitialCase([], null)} />);
    expect(screen.getByTestId("preview-case-missing")).toHaveTextContent(
      "未找到可用用例",
    );
  });

  it("shows no noise for a normal, remembered selection", () => {
    const { container } = render(
      <SelectionBadges
        selection={resolveInitialCase(
          [DEFAULT_CASE_KEY, "artifacts-full"],
          "artifacts-full",
        )}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
