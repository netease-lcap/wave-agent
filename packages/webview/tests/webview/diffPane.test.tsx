import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DiffPane, formatDiffComment } from "../../src/components/DiffPane";
import type {
  WorkspaceDiffBase,
  WorkspaceDiffCommit,
  WorkspaceDiffFile,
  WorkspaceDiffScope,
} from "../../src/components/DiffPane";
import { createMockVscode, sendCommand } from "./test-utils";

function makeFile(
  overrides: Partial<WorkspaceDiffFile> = {},
): WorkspaceDiffFile {
  return {
    path: "src/a.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    hunks: "@@ -1 +1 @@\n-old\n+new1\n+new2",
    truncated: false,
    binary: false,
    ...overrides,
  };
}

interface PaneOptions {
  paneId?: string;
  visible?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  workdir?: string;
  onAddComment?: (text: string) => void;
  treeVisible?: boolean;
  selectedCommit?: string | null;
  width?: number;
  onTreeVisibleChange?: (visible: boolean) => void;
  onSelectedCommitChange?: (sha: string | null) => void;
}

function renderPane(options?: PaneOptions) {
  const vscode = createMockVscode();
  const shared = {
    vscode,
    width: options?.width ?? 420,
    paneId: options?.paneId,
    onAddComment: options?.onAddComment,
    treeVisible: options?.treeVisible ?? true,
    onTreeVisibleChange: options?.onTreeVisibleChange ?? (() => {}),
    selectedCommit: options?.selectedCommit ?? null,
    onSelectedCommitChange: options?.onSelectedCommitChange ?? (() => {}),
  };
  const result = render(
    <DiffPane
      {...shared}
      visible={options?.visible ?? true}
      isStreaming={options?.isStreaming ?? false}
      sessionId={options?.sessionId}
      workdir={options?.workdir}
    />,
  );
  const rerenderWith = (props: {
    visible?: boolean;
    isStreaming?: boolean;
    sessionId?: string;
    workdir?: string;
    treeVisible?: boolean;
    selectedCommit?: string | null;
    width?: number;
  }) =>
    result.rerender(
      <DiffPane
        {...shared}
        width={props.width ?? shared.width}
        visible={props.visible ?? true}
        isStreaming={props.isStreaming ?? false}
        sessionId={props.sessionId}
        workdir={props.workdir}
        treeVisible={props.treeVisible ?? shared.treeVisible}
        // `null` is a real selection ("all changes") — only an absent key
        // falls back to the initially rendered value.
        selectedCommit={
          props.selectedCommit === undefined
            ? shared.selectedCommit
            : props.selectedCommit
        }
      />,
    );
  return { ...result, rerenderWith, vscode };
}

function sendDiffResult(
  files: WorkspaceDiffFile[],
  options?: {
    paneId?: string;
    base?: WorkspaceDiffBase;
    scope?: WorkspaceDiffScope;
    commits?: WorkspaceDiffCommit[];
    requestId?: number;
  },
) {
  sendCommand("desktopWorkspaceDiff", {
    result: {
      kind: "ok",
      files,
      base: options?.base,
      scope: options?.scope,
      commits: options?.commits,
    },
    ...(options?.paneId !== undefined ? { paneId: options.paneId } : {}),
    ...(options?.requestId !== undefined
      ? { requestId: options.requestId }
      : {}),
  });
}

const lastDiffRequest = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls.filter(
    ([msg]) => msg.command === "desktopGetWorkspaceDiff",
  );

/** Payload of the most recent diff request (`.at(-1)` needs a newer lib target). */
const latestDiffPayload = (vscode: ReturnType<typeof createMockVscode>) => {
  const requests = lastDiffRequest(vscode);
  return requests[requests.length - 1]?.[0];
};

describe("DiffPane", () => {
  it("requests the workspace diff on mount and shows a loading state", () => {
    const { vscode } = renderPane();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopGetWorkspaceDiff",
      requestId: 1,
    });
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("renders file blocks with status, path and +/- stats", () => {
    renderPane();
    sendDiffResult([
      makeFile(),
      makeFile({
        path: "img/logo.png",
        status: "added",
        additions: 0,
        deletions: 0,
        binary: true,
        hunks: "",
      }),
    ]);
    expect(screen.getByTestId("diff-file-modified")).toBeInTheDocument();
    expect(screen.getByTestId("diff-file-added")).toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
    expect(screen.getByText("新增")).toBeInTheDocument();
    // Scoped to the accordion header: the file tree shows the same stats.
    const header = screen
      .getByTestId("diff-file-modified")
      .querySelector(".diff-file-header") as HTMLElement;
    expect(header.querySelector(".diff-file-stats-add")).toHaveTextContent(
      "+2",
    );
    expect(header.querySelector(".diff-file-stats-del")).toHaveTextContent(
      "-1",
    );
  });

  it("renders hunks with added/removed/context line classes", () => {
    const { container } = renderPane();
    sendDiffResult([makeFile()]);
    expect(container.querySelector(".diff-line-hunk")).toHaveTextContent(
      "@@ -1 +1 @@",
    );
    expect(
      container.querySelector(".diff-line-added .diff-content"),
    ).toHaveTextContent("new1");
    expect(
      container.querySelector(".diff-line-removed .diff-content"),
    ).toHaveTextContent("old");
  });

  it("pairs adjacent removed/added lines and highlights word-level changes", () => {
    const { container } = renderPane();
    sendDiffResult([
      makeFile({ hunks: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;" }),
    ]);
    const removed = container.querySelector(".diff-line-removed");
    const added = container.querySelector(".diff-line-added");
    // Unchanged words keep the line-level background; only the changed word
    // gets the deeper word-level highlight.
    expect(removed?.querySelector(".diff-word-unchanged")).toHaveTextContent(
      "const x =",
    );
    expect(removed?.querySelector(".diff-word-removed")).toHaveTextContent("1");
    expect(added?.querySelector(".diff-word-unchanged")).toHaveTextContent(
      "const x =",
    );
    expect(added?.querySelector(".diff-word-added")).toHaveTextContent("2");
    // Rows are rendered as removed-then-added pairs.
    expect(removed?.querySelector(".diff-prefix")).toHaveTextContent("-");
    expect(added?.querySelector(".diff-prefix")).toHaveTextContent("+");
  });

  it("highlights whole lines for unpaired added-only and removed-only blocks", () => {
    const { container } = renderPane();
    // Removed-only hunk (no added lines) and added-only hunk (no removed
    // lines) — nothing to pair, the whole line is word-level highlighted
    // (same as the message diff block).
    sendDiffResult([
      makeFile({
        hunks: "@@ -1 +1 @@\n-only-removed\n@@ -2 +2 @@\n+only-added",
        additions: 1,
        deletions: 1,
      }),
    ]);
    const removed = container.querySelector(".diff-line-removed");
    const added = container.querySelector(".diff-line-added");
    expect(removed?.querySelector(".diff-word-removed")).toHaveTextContent(
      "only-removed",
    );
    expect(added?.querySelector(".diff-word-added")).toHaveTextContent(
      "only-added",
    );
  });

  it("resets word-level pairing at context lines and hunk headers", () => {
    const { container } = renderPane();
    sendDiffResult([
      makeFile({
        hunks:
          "@@ -1 +3 @@\n context\n-old-a\n+new-a\n@@ -10 +10 @@\n-old-b\n+new-b",
      }),
    ]);
    const removed = container.querySelectorAll(".diff-line-removed");
    const added = container.querySelectorAll(".diff-line-added");
    // Pair (old-a, new-a) then a second (old-b, new-b) after a fresh hunk
    // header — pairing must not leak across the hunk boundary.
    expect(removed).toHaveLength(2);
    expect(added).toHaveLength(2);
    // diffWords('old-a', 'new-a') marks only the changed words ('old'/'new');
    // the '-a' suffix stays on the line-level background.
    expect(removed[0].querySelector(".diff-word-removed")).toHaveTextContent(
      "old",
    );
    expect(added[0].querySelector(".diff-word-added")).toHaveTextContent("new");
    expect(removed[1].querySelector(".diff-word-removed")).toHaveTextContent(
      "old",
    );
    expect(added[1].querySelector(".diff-word-added")).toHaveTextContent("new");
    expect(removed[0].querySelector(".diff-content")).toHaveTextContent(
      "old-a",
    );
    expect(added[0].querySelector(".diff-content")).toHaveTextContent("new-a");
  });

  it("does not pair lines across a hunk boundary", () => {
    const { container } = renderPane();
    // Hunk 1 has only a removed line, hunk 2 only an added line — pairing
    // would merge them, so both must stay whole-line highlighted instead.
    sendDiffResult([
      makeFile({
        hunks: "@@ -1 +1 @@\n-only-x\n@@ -10 +10 @@\n+only-y",
        additions: 1,
        deletions: 1,
      }),
    ]);
    const removed = container.querySelector(".diff-line-removed");
    const added = container.querySelector(".diff-line-added");
    expect(removed?.querySelector(".diff-word-removed")).toHaveTextContent(
      "only-x",
    );
    expect(added?.querySelector(".diff-word-added")).toHaveTextContent(
      "only-y",
    );
  });

  it("keeps line-comment buttons on word-level highlighted rows", () => {
    renderPane();
    sendDiffResult([
      makeFile({ hunks: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;" }),
    ]);
    expect(screen.getByTestId("diff-comment-add-1")).toBeInTheDocument();
    expect(screen.getByTestId("diff-comment-add-2")).toBeInTheDocument();
  });

  it("binary files show a placeholder instead of hunks", () => {
    renderPane();
    sendDiffResult([makeFile({ binary: true, hunks: "" })]);
    expect(screen.getByText("二进制文件，不显示差异")).toBeInTheDocument();
  });

  it("truncated files show a truncation note", () => {
    renderPane();
    sendDiffResult([makeFile({ truncated: true })]);
    expect(screen.getByText("差异过大，已截断…")).toBeInTheDocument();
  });

  it("renames without content changes show the source path", () => {
    renderPane();
    sendDiffResult([
      makeFile({ status: "renamed", oldPath: "src/old.ts", hunks: "" }),
    ]);
    expect(screen.getByText("重命名自 src/old.ts")).toBeInTheDocument();
  });

  it("shows the not-a-repo state", () => {
    renderPane();
    sendCommand("desktopWorkspaceDiff", { result: { kind: "not-a-repo" } });
    expect(screen.getByText("非 git 仓库")).toBeInTheDocument();
  });

  it("shows the no-changes state for an empty file list", () => {
    renderPane();
    sendDiffResult([]);
    expect(screen.getByText("无改动")).toBeInTheDocument();
  });

  it("collapses and expands a file block via its header", () => {
    const { container } = renderPane();
    sendDiffResult([makeFile()]);
    const header = container.querySelector(".diff-file-header") as HTMLElement;
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("new1")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("new1")).toBeInTheDocument();
  });

  describe("mutual-exclusion accordion", () => {
    it("expands only the first file by default", () => {
      const { container } = renderPane();
      sendDiffResult([
        makeFile(),
        makeFile({ path: "src/b.ts" }),
        makeFile({ path: "src/c.ts" }),
      ]);
      const headers = container.querySelectorAll(".diff-file-header");
      expect(headers).toHaveLength(3);
      expect(headers[0]).toHaveAttribute("aria-expanded", "true");
      expect(headers[1]).toHaveAttribute("aria-expanded", "false");
      expect(headers[2]).toHaveAttribute("aria-expanded", "false");
      // Only the first file's hunks are in the DOM, all headers remain.
      expect(screen.getByText("new1")).toBeInTheDocument();
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(1);
    });

    it("expanding another file collapses the previously expanded one", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      const headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[1]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(1);
    });

    it("clicking the expanded file collapses it", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      const headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[0]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "false");
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(0);
    });

    it("keeps the expanded file across a refresh", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      let headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[1]);
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      // Refresh arrives with the same paths but new hunks; the expanded
      // file must stay expanded (not reset to the first file).
      sendDiffResult([
        makeFile({ path: "src/a.ts", hunks: "@@ -1 +1 @@\n-old\n+updated-a" }),
        makeFile({ path: "src/b.ts", hunks: "@@ -1 +1 @@\n-old\n+updated-b" }),
      ]);
      headers = container.querySelectorAll(".diff-file-header");
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("updated-b")).toBeInTheDocument();
      expect(screen.queryByText("updated-a")).not.toBeInTheDocument();
    });
  });

  describe("toolbar range", () => {
    const base: WorkspaceDiffBase = {
      label: "main",
      sha: "b".repeat(40),
      kind: "default-branch",
      ref: "refs/remotes/origin/main",
    };

    it("shows the read-only range and the range totals", () => {
      const { container } = renderPane();
      sendDiffResult(
        [
          makeFile(),
          makeFile({ path: "src/b.ts", additions: 5, deletions: 0 }),
        ],
        { base },
      );
      const toolbar = container.querySelector(
        ".preview-pane-toolbar",
      ) as HTMLElement;
      expect(toolbar).toHaveTextContent("main → 工作树");
      expect(toolbar.querySelector(".diff-range")).toHaveAttribute(
        "title",
        expect.stringContaining("main"),
      );
      const totals = container.querySelector(".diff-totals") as HTMLElement;
      expect(totals).toHaveTextContent("+7");
      expect(totals).toHaveTextContent("-1");
      expect(totals).toHaveTextContent("2 个文件");
      // Read-only: neither end of the range is a control.
      expect(
        toolbar.querySelectorAll(".diff-range button, .diff-range select"),
      ).toHaveLength(0);
    });

    it("shows the commit short sha instead of the working-tree range for a commit scope", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile()], {
        base,
        scope: {
          kind: "commit",
          sha: "c".repeat(40),
          shortSha: "c123456",
          subject: "fix bug",
        },
      });
      const toolbar = container.querySelector(
        ".preview-pane-toolbar",
      ) as HTMLElement;
      expect(toolbar).toHaveTextContent("c123456");
      expect(toolbar).not.toHaveTextContent("工作树");
      expect(toolbar.querySelector(".diff-range")).toHaveAttribute(
        "title",
        expect.stringContaining("fix bug"),
      );
      // Nothing to truncate: the short sha is the whole range.
      const range = container.querySelector(".diff-range") as HTMLElement;
      expect(range.querySelector(".diff-range-lead")).toBeNull();
      expect(range.querySelector(".diff-range-target")).toHaveTextContent(
        "c123456",
      );
    });

    it("splits the range so a narrow slot ellipsizes the base, not the target", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile()], {
        base: { ...base, label: "feature/very-long-session-branch" },
      });
      const range = container.querySelector(".diff-range") as HTMLElement;
      expect(range.querySelector(".diff-range-lead")).toHaveTextContent(
        "feature/very-long-session-branch",
      );
      expect(range.querySelector(".diff-range-target")).toHaveTextContent(
        "→ 工作树",
      );
      // The rendered text is unchanged by the split.
      expect(range).toHaveTextContent(
        "feature/very-long-session-branch → 工作树",
      );
    });
  });

  describe("file tree", () => {
    const nested = [
      makeFile({ path: "docs/guide/a.md", additions: 1, deletions: 0 }),
      makeFile({ path: "docs/conf.md", additions: 2, deletions: 0 }),
      makeFile({
        path: "src/nested/deep/x.ts",
        additions: 3,
        deletions: 1,
      }),
    ];

    it("groups files by directory in accordion order, with no node for the repo root", () => {
      renderPane();
      sendDiffResult(nested);
      const tree = screen.getByTestId("diff-tree");
      const names = Array.from(
        tree.querySelectorAll(".diff-tree-dir, .diff-tree-file"),
      ).map((el) => el.querySelector(".diff-tree-name")?.textContent);
      expect(names).toEqual([
        "docs",
        "conf.md",
        "guide",
        "a.md",
        "src",
        "nested",
        "deep",
        "x.ts",
      ]);
      const fileRow = tree.querySelector(
        "[data-path='src/nested/deep/x.ts']",
      ) as HTMLElement;
      expect(fileRow).toHaveTextContent("+3");
      expect(fileRow).toHaveTextContent("-1");
      expect(fileRow).toHaveAttribute("title", "src/nested/deep/x.ts");
    });

    it("collapses and re-expands a directory without moving its siblings", () => {
      renderPane();
      sendDiffResult(nested);
      const tree = screen.getByTestId("diff-tree");
      const docsDir = tree.querySelector(
        "[data-testid='diff-tree-dir']",
      ) as HTMLElement;
      expect(docsDir).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(docsDir);
      expect(docsDir).toHaveAttribute("aria-expanded", "false");
      expect(tree.querySelector("[data-path='docs/conf.md']")).toBeNull();
      expect(
        tree.querySelector("[data-path='src/nested/deep/x.ts']"),
      ).not.toBeNull();
      fireEvent.click(docsDir);
      expect(tree.querySelector("[data-path='docs/conf.md']")).not.toBeNull();
    });

    it("expands the clicked file and scrolls it into view", () => {
      const scrollIntoView = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        const { container } = renderPane();
        sendDiffResult(nested);
        const headers = () => container.querySelectorAll(".diff-file-header");
        expect(headers()[0]).toHaveAttribute("aria-expanded", "true");
        fireEvent.click(
          screen
            .getByTestId("diff-tree")
            .querySelector("[data-path='src/nested/deep/x.ts']") as HTMLElement,
        );
        // Mutual exclusion still holds, and the tree click is a navigation
        // (not a toggle): the clicked file ends up expanded.
        expect(headers()[2]).toHaveAttribute("aria-expanded", "true");
        expect(headers()[0]).toHaveAttribute("aria-expanded", "false");
        expect(scrollIntoView).toHaveBeenCalled();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it("toggles the sidebar through the toolbar button", () => {
      const onTreeVisibleChange = vi.fn();
      const { rerenderWith } = renderPane({ onTreeVisibleChange });
      sendDiffResult([makeFile()]);
      expect(screen.getByTestId("diff-sidebar")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("diff-tree-toggle"));
      expect(onTreeVisibleChange).toHaveBeenCalledWith(false);
      rerenderWith({ treeVisible: false });
      expect(screen.queryByTestId("diff-sidebar")).not.toBeInTheDocument();
      // Hiding the sidebar must not disturb the diff itself.
      expect(screen.getByText("new1")).toBeInTheDocument();
    });

    it("auto-hides the sidebar when the panel is too narrow and restores it when widened", () => {
      const { rerenderWith } = renderPane({ width: 320 });
      sendDiffResult([makeFile()]);
      expect(screen.queryByTestId("diff-sidebar")).not.toBeInTheDocument();
      rerenderWith({ width: 600 });
      expect(screen.getByTestId("diff-sidebar")).toBeInTheDocument();
    });
  });

  describe("commit selection", () => {
    const base: WorkspaceDiffBase = {
      label: "main",
      sha: "b".repeat(40),
      kind: "default-branch",
      ref: "refs/remotes/origin/main",
    };
    const commits: WorkspaceDiffCommit[] = [
      { sha: "c".repeat(40), shortSha: "c111111", subject: "add feature" },
      { sha: "b".repeat(40), shortSha: "b222222", subject: "fix bug" },
    ];

    it("lists all changes first, then the commits newest first", () => {
      renderPane();
      sendDiffResult([makeFile()], { base, commits });
      const labels = Array.from(
        screen
          .getByTestId("diff-commits")
          .querySelectorAll(".diff-commit-subject"),
      ).map((el) => el.textContent);
      expect(labels).toEqual(["全部改动", "add feature", "fix bug"]);
      expect(screen.getByTestId("diff-commit-all")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("renders no commit list when the range has no commits", () => {
      renderPane();
      sendDiffResult([makeFile()], { base, commits: [] });
      expect(screen.queryByTestId("diff-commits")).not.toBeInTheDocument();
    });

    it("requests the selected commit's diff and reports the selection", () => {
      const onSelectedCommitChange = vi.fn();
      const { vscode, rerenderWith } = renderPane({ onSelectedCommitChange });
      sendDiffResult([makeFile()], { base, commits });
      fireEvent.click(screen.getAllByTestId("diff-commit")[0]);
      expect(onSelectedCommitChange).toHaveBeenCalledWith("c".repeat(40));
      expect(latestDiffPayload(vscode)).toEqual({
        command: "desktopGetWorkspaceDiff",
        requestId: 2,
        commit: "c".repeat(40),
      });
      // The selection is owned by the session store, so the pressed state
      // follows the prop the parent feeds back.
      rerenderWith({ selectedCommit: "c".repeat(40) });
      expect(screen.getAllByTestId("diff-commit")[0]).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("diff-commit-all")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("switches back to all changes and ignores re-selecting the current range", () => {
      const onSelectedCommitChange = vi.fn();
      const { vscode, rerenderWith } = renderPane({
        onSelectedCommitChange,
        selectedCommit: "c".repeat(40),
      });
      sendDiffResult([makeFile()], {
        base,
        commits,
        scope: {
          kind: "commit",
          sha: "c".repeat(40),
          shortSha: "c111111",
          subject: "add feature",
        },
      });
      const before = lastDiffRequest(vscode).length;
      fireEvent.click(screen.getByTestId("diff-commit-all"));
      expect(onSelectedCommitChange).toHaveBeenCalledWith(null);
      expect(lastDiffRequest(vscode).length).toBe(before + 1);
      expect(latestDiffPayload(vscode)).not.toHaveProperty("commit");
      // "全部改动" is now the active range: clicking it again is a no-op.
      rerenderWith({ selectedCommit: null });
      fireEvent.click(screen.getByTestId("diff-commit-all"));
      expect(lastDiffRequest(vscode).length).toBe(before + 1);
    });

    it("clears a selection the host has already fallen back from", () => {
      const onSelectedCommitChange = vi.fn();
      renderPane({
        onSelectedCommitChange,
        selectedCommit: "c".repeat(40),
      });
      sendDiffResult([makeFile()], { base, scope: { kind: "all" } });
      expect(onSelectedCommitChange).toHaveBeenCalledWith(null);
    });

    it("keeps a selection the host still honours", () => {
      const onSelectedCommitChange = vi.fn();
      renderPane({
        onSelectedCommitChange,
        selectedCommit: "c".repeat(40),
      });
      sendDiffResult([makeFile()], {
        base,
        scope: {
          kind: "commit",
          sha: "c".repeat(40),
          shortSha: "c111111",
          subject: "add feature",
        },
      });
      expect(onSelectedCommitChange).not.toHaveBeenCalled();
    });
  });

  describe("drops superseded replies", () => {
    it("ignores a reply whose requestId is not the latest request", () => {
      const { vscode } = renderPane();
      expect(lastDiffRequest(vscode)).toHaveLength(1);
      fireEvent.click(screen.getByTestId("diff-refresh"));
      expect(lastDiffRequest(vscode)).toHaveLength(2);
      sendDiffResult([makeFile({ path: "src/stale.ts" })], { requestId: 1 });
      expect(screen.queryByText("src/stale.ts")).not.toBeInTheDocument();
      expect(screen.getByText("加载中…")).toBeInTheDocument();
      sendDiffResult([makeFile({ path: "src/fresh.ts" })], { requestId: 2 });
      expect(screen.getByText("src/fresh.ts")).toBeInTheDocument();
    });
  });

  describe("large-range degradation", () => {
    it("collapses every file, shows a notice, and still allows manual expansion", () => {
      const { container } = renderPane();
      sendDiffResult([
        makeFile({ additions: 6000, deletions: 0 }),
        makeFile({ path: "src/b.ts" }),
      ]);
      expect(screen.getByTestId("diff-collapse-notice")).toHaveTextContent(
        "差异过大，已折叠全部文件",
      );
      const headers = container.querySelectorAll(".diff-file-header");
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(headers[0]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "true");
    });

    it("does not leave a later small range collapsed", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile({ additions: 6000, deletions: 0 })]);
      sendDiffResult([makeFile()]);
      expect(
        container.querySelectorAll(".diff-file-header")[0],
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.queryByTestId("diff-collapse-notice"),
      ).not.toBeInTheDocument();
    });

    it("drops word-level pairing for an oversized file but keeps line colors and comments", () => {
      const { container } = renderPane();
      sendDiffResult([
        makeFile({
          additions: 600,
          deletions: 500,
          hunks: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;",
        }),
      ]);
      const removed = container.querySelector(
        ".diff-line-removed",
      ) as HTMLElement;
      expect(removed.querySelector(".diff-word-removed")).toBeNull();
      expect(removed.querySelector(".diff-content")).toHaveTextContent(
        "const x = 1;",
      );
      expect(container.querySelector(".diff-line-added")).not.toBeNull();
      expect(screen.getByTestId("diff-comment-add-1")).toBeInTheDocument();
    });
  });

  describe("view switch", () => {
    it("renders a pair in two columns without a new request", () => {
      const { vscode, container } = renderPane();
      sendDiffResult([
        makeFile({ hunks: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;" }),
      ]);
      const before = lastDiffRequest(vscode).length;
      fireEvent.click(screen.getByTestId("diff-view-split"));
      expect(lastDiffRequest(vscode).length).toBe(before);
      const row = container.querySelector(".diff-split-row") as HTMLElement;
      const cells = row.children;
      expect(cells[0]).toHaveClass("diff-line", "diff-line-removed");
      expect(cells[1]).toHaveClass("diff-line", "diff-line-added");
      // One line-number column per side.
      expect(cells[0].querySelector(".diff-line-number")).toHaveTextContent(
        "1",
      );
      expect(cells[1].querySelector(".diff-line-number")).toHaveTextContent(
        "1",
      );
      // Word-level pairing is unchanged by the layout.
      expect(row.querySelector(".diff-word-removed")).toHaveTextContent("1");
      expect(row.querySelector(".diff-word-added")).toHaveTextContent("2");
      // The hunk header spans the row.
      expect(screen.getByText("@@ -1 +1 @@")).toBeInTheDocument();
    });

    it("pads the missing half of an unpaired line", () => {
      const { container } = renderPane();
      sendDiffResult([makeFile({ hunks: "@@ -1 +1 @@\n-only-removed" })]);
      fireEvent.click(screen.getByTestId("diff-view-split"));
      const row = container.querySelector(".diff-split-row") as HTMLElement;
      expect(row.querySelector(".diff-line-removed")).not.toBeNull();
      expect(row.querySelector(".diff-split-empty")).not.toBeNull();
    });

    it("keeps the expanded file, closes the comment box and drops the draft", () => {
      const { container, vscode } = renderPane();
      sendDiffResult([
        makeFile({ hunks: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;" }),
      ]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      fireEvent.change(screen.getByTestId("diff-comment-input"), {
        target: { value: "半截草稿" },
      });
      const before = lastDiffRequest(vscode).length;
      fireEvent.click(screen.getByTestId("diff-view-split"));
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
      expect(lastDiffRequest(vscode).length).toBe(before);
      // Back to unified: the draft is gone, the file is still expanded.
      fireEvent.click(screen.getByTestId("diff-view-unified"));
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(1);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      expect(screen.getByTestId("diff-comment-input")).toHaveValue("");
    });

    it("spans the comment box across both columns", () => {
      renderPane();
      sendDiffResult([
        makeFile({ hunks: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;" }),
      ]);
      fireEvent.click(screen.getByTestId("diff-view-split"));
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      const box = screen.getByTestId("diff-comment-box");
      expect(box.closest(".diff-split-row")).not.toBeNull();
    });
  });

  it("refresh button requests the diff again", () => {
    const { vscode } = renderPane();
    expect(lastDiffRequest(vscode)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("diff-refresh"));
    expect(lastDiffRequest(vscode)).toHaveLength(2);
  });

  it("has no in-pane close button (关闭统一由一级 tab 控制)", () => {
    renderPane();
    expect(screen.queryByTestId("diff-close")).not.toBeInTheDocument();
  });

  it("tags requests with paneId and ignores responses for other panes", () => {
    const { vscode } = renderPane({ paneId: "pane-1" });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopGetWorkspaceDiff",
      paneId: "pane-1",
      requestId: 1,
    });
    sendDiffResult([makeFile()], { paneId: "pane-2" });
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    sendDiffResult([], { paneId: "pane-1" });
    expect(screen.getByText("无改动")).toBeInTheDocument();
  });

  it("re-showing a hidden panel triggers a fresh load", () => {
    const { vscode, rerenderWith } = renderPane({ visible: false });
    expect(lastDiffRequest(vscode)).toHaveLength(0);
    rerenderWith({ visible: true });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
  });

  it("refreshes when generation ends while visible", () => {
    const { vscode, rerenderWith } = renderPane({ isStreaming: true });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
    rerenderWith({ isStreaming: false });
    expect(lastDiffRequest(vscode)).toHaveLength(2);
  });

  it("keeps current files visible while the generation-end refresh is in flight", () => {
    const { rerenderWith } = renderPane({ isStreaming: true });
    sendDiffResult([makeFile()]);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    rerenderWith({ isStreaming: false });
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    sendDiffResult([makeFile({ path: "src/b.ts" })]);
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("keeps current files visible on manual refresh and spins the refresh icon until the response arrives", () => {
    renderPane();
    sendDiffResult([makeFile()]);
    fireEvent.click(screen.getByTestId("diff-refresh"));
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(
      screen.getByTestId("diff-refresh").querySelector(".is-spinning"),
    ).not.toBeNull();
    sendDiffResult([makeFile()]);
    expect(
      screen.getByTestId("diff-refresh").querySelector(".is-spinning"),
    ).toBeNull();
  });

  it("resets to the loading state when the session context changes", () => {
    const { rerenderWith } = renderPane({ sessionId: "s1", workdir: "/w/a" });
    sendDiffResult([makeFile()]);
    rerenderWith({ sessionId: "s2", workdir: "/w/b" });
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
  });

  it("does not refresh on generation end while hidden", () => {
    const { vscode, rerenderWith } = renderPane({
      visible: false,
      isStreaming: true,
    });
    rerenderWith({ visible: false, isStreaming: false });
    expect(lastDiffRequest(vscode)).toHaveLength(0);
  });

  it("refreshes when the session context changes while visible", () => {
    const { vscode, rerenderWith } = renderPane({
      sessionId: "s1",
      workdir: "/w/a",
    });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
    rerenderWith({ sessionId: "s2", workdir: "/w/b" });
    expect(lastDiffRequest(vscode)).toHaveLength(2);
  });

  describe("line comments", () => {
    it("formats a diff-line comment with path, prefix and text", () => {
      expect(
        formatDiffComment({
          path: "a.ts",
          prefix: "+",
          text: "x",
          comment: "改这里",
        }),
      ).toBe("**差异评论** · a.ts\n`+`「x」\n\n改这里");
      // context-line prefix (space) is omitted
      expect(
        formatDiffComment({
          path: "a.ts",
          prefix: " ",
          text: "x",
          comment: "c",
        }),
      ).toBe("**差异评论** · a.ts\n「x」\n\nc");
    });

    it("shows a comment button on each commentable line (not on @@ headers)", () => {
      renderPane();
      sendDiffResult([makeFile()]);
      expect(screen.getByTestId("diff-comment-add-1")).toBeInTheDocument();
      expect(screen.getByTestId("diff-comment-add-2")).toBeInTheDocument();
      expect(screen.getByTestId("diff-comment-add-3")).toBeInTheDocument();
      expect(
        screen.queryByTestId("diff-comment-add-0"),
      ).not.toBeInTheDocument();
    });

    it("labels each button with its own side, so equal line numbers stay distinct", () => {
      renderPane();
      // A pair whose removed and added lines are both line 12: without
      // the 旧/新 suffix both buttons would carry the same accessible name.
      sendDiffResult([
        makeFile({
          hunks:
            "@@ -12,2 +12,2 @@\n-  const handleSubmit = () => {\n+  const handleSubmit = (e) => {",
        }),
      ]);
      expect(
        screen.getByRole("button", {
          name: "评论 src/a.ts 第 12 行（旧）",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "评论 src/a.ts 第 12 行（新）",
        }),
      ).toBeInTheDocument();
    });

    it("opens a comment box under the clicked line with the file path", () => {
      renderPane();
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      const box = screen.getByTestId("diff-comment-box");
      expect(box).toBeInTheDocument();
      expect(screen.getByTestId("diff-comment-input")).toBeInTheDocument();
      expect(box.querySelector(".diff-comment-box-tag")).toHaveTextContent(
        "src/a.ts",
      );
    });

    it("appends the comment to the input and closes the box on submit", () => {
      const onAddComment = vi.fn();
      renderPane({ onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      fireEvent.change(screen.getByTestId("diff-comment-input"), {
        target: { value: "改这里" },
      });
      fireEvent.click(screen.getByTestId("diff-comment-submit"));
      expect(onAddComment).toHaveBeenCalledWith(
        "**差异评论** · src/a.ts\n`+`「new1」\n\n改这里",
      );
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("submits on Enter (without shift)", () => {
      const onAddComment = vi.fn();
      renderPane({ onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      const input = screen.getByTestId("diff-comment-input");
      fireEvent.change(input, { target: { value: "好" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAddComment).toHaveBeenCalled();
    });

    it("does not submit on Enter while IME is composing (e.g. pinyin)", () => {
      const onAddComment = vi.fn();
      renderPane({ onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      const input = screen.getByTestId("diff-comment-input");
      fireEvent.change(input, { target: { value: "改这里" } });
      // Chinese IME uses Enter to confirm the candidate; that keydown fires
      // with isComposing=true (keyCode 229) and must NOT submit the draft.
      fireEvent.keyDown(input, {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
      });
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it("does not submit when the comment is empty", () => {
      const onAddComment = vi.fn();
      renderPane({ onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      fireEvent.click(screen.getByTestId("diff-comment-submit"));
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it("closes the box on Escape", () => {
      renderPane();
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      fireEvent.keyDown(screen.getByTestId("diff-comment-input"), {
        key: "Escape",
      });
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("closes the box via the cancel button", () => {
      renderPane();
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      fireEvent.click(screen.getByTestId("diff-comment-cancel"));
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("discards the open comment box on refresh", () => {
      renderPane();
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      expect(screen.getByTestId("diff-comment-box")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("diff-refresh"));
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("keeps at most one comment box open (clicking another line moves it)", () => {
      renderPane();
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getByTestId("diff-comment-add-2"));
      expect(screen.getByTestId("diff-comment-box")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("diff-comment-add-3"));
      expect(screen.queryAllByTestId("diff-comment-box")).toHaveLength(1);
    });
  });
});
