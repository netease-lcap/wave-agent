import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { Message } from "wave-agent-sdk";
import {
  getWorkspaceDiff,
  type WorkspaceDiffFile,
} from "../utils/workspaceDiff.js";
import {
  collectTurnDiffs,
  parseUnifiedDiff,
  type DiffFileEntry,
  type DiffLine,
  type SessionTurnDiff,
} from "../utils/sessionDiff.js";
import { ScrolledContent } from "./ScrolledContent.js";
import { useLineScroll } from "../hooks/useLineScroll.js";

/** Overlay height as a fraction of the terminal height. */
const DIFF_OVERLAY_HEIGHT_RATIO = 0.6;
/** Title + stats row. */
const LIST_CHROME_ROWS = 2;
/** Title + source row + path row + hint row. */
const DETAIL_CHROME_ROWS = 4;
/** ↑ / ↓ "more" indicators, at most one each. */
const SCROLL_INDICATOR_BUDGET = 2;

type ViewMode = "list" | "detail";

type DiffSource =
  | { kind: "workspace" }
  | { kind: "turn"; turn: SessionTurnDiff };

type WorkspaceState =
  | { status: "loading" }
  | { status: "ready"; files: DiffFileEntry[]; note?: string }
  | { status: "error"; message: string };

export interface DiffManagerProps {
  /**
   * The session's workspace root, not the agent's current cwd: this panel
   * answers "what changed in my project", so a `cd` the agent did inside the
   * session must not move its base (see `.wave/rules/workdir.md` — the desktop
   * diff panel reads the same value).
   */
  workspaceRoot: string;
  messages: Message[];
  onCancel: () => void;
  /** Whole-overlay row budget. Defaults to a fraction of the terminal; tests
   *  pass it explicitly for a deterministic layout. */
  maxHeight?: number;
}

function toEntry(file: WorkspaceDiffFile): DiffFileEntry {
  return {
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    lines: file.binary ? [] : parseUnifiedDiff(file.hunks),
    binary: file.binary,
    truncated: file.truncated,
    note: file.binary
      ? "Binary file — no textual diff"
      : file.status === "untracked"
        ? "New file, not staged yet"
        : undefined,
  };
}

function sourceLabel(source: DiffSource | undefined): string {
  if (!source || source.kind === "workspace") return "Uncommitted changes";
  return `Turn ${source.turn.turnIndex}`;
}

function sourceSubLabel(source: DiffSource | undefined): string {
  if (!source || source.kind === "workspace") return "git diff HEAD";
  return source.turn.promptPreview ? `"${source.turn.promptPreview}"` : "";
}

function lineColor(line: DiffLine): string | undefined {
  switch (line.kind) {
    case "add":
      return "green";
    case "remove":
      return "red";
    case "hunk":
      return "cyan";
    default:
      return undefined;
  }
}

function linePrefix(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "+";
    case "remove":
      return "-";
    case "context":
      return " ";
    default:
      return "";
  }
}

/**
 * `/diff` overlay (aligned with Claude Code's `/diff`): the uncommitted working
 * tree changes, plus one entry per conversation turn that edited files. ←/→
 * switch source, ↑/↓ select a file, Enter opens its hunks, Esc goes back / out.
 */
export const DiffManager: React.FC<DiffManagerProps> = ({
  workspaceRoot,
  messages,
  onCancel,
  maxHeight,
}) => {
  const { rows } = useWindowSize();
  const overlayMaxHeight =
    maxHeight ?? Math.max(Math.round(rows * DIFF_OVERLAY_HEIGHT_RATIO), 12);

  const [workspace, setWorkspace] = useState<WorkspaceState>({
    status: "loading",
  });
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getWorkspaceDiff(workspaceRoot, {
          uncommitted: true,
        });
        if (cancelled) return;
        if (result.kind === "not-a-repo") {
          setWorkspace({
            status: "ready",
            files: [],
            note: "Not a git repository",
          });
          return;
        }
        if (result.kind === "transient") {
          // A half-finished merge/rebase holds incoming changes this session
          // did not make; presenting them as the user's own diff would lie.
          setWorkspace({
            status: "ready",
            files: [],
            note: `A ${result.operation} is in progress — no reliable diff`,
          });
          return;
        }
        setWorkspace({
          status: "ready",
          files: result.files.map(toEntry),
          note:
            result.files.length === 0 ? "No uncommitted changes" : undefined,
        });
      } catch (error) {
        if (!cancelled) {
          setWorkspace({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  const sources = useMemo<DiffSource[]>(() => {
    const turns = collectTurnDiffs(messages, workspaceRoot);
    return [
      { kind: "workspace" },
      ...turns.map((turn) => ({ kind: "turn" as const, turn })),
    ];
  }, [messages, workspaceRoot]);

  // A rewind (or a completed turn) can shrink the list under the cursor.
  const activeIndex = Math.min(sourceIndex, sources.length - 1);
  const activeSource = sources[activeIndex];

  const files: DiffFileEntry[] = useMemo(() => {
    if (!activeSource || activeSource.kind === "workspace") {
      return workspace.status === "ready" ? workspace.files : [];
    }
    return activeSource.turn.files;
  }, [activeSource, workspace]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, files.length - 1));
  const selectedFile = files[clampedIndex];

  const stats = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const listVisible = Math.max(1, overlayMaxHeight - LIST_CHROME_ROWS);
  const detailVisible = Math.max(
    1,
    overlayMaxHeight - DETAIL_CHROME_ROWS - SCROLL_INDICATOR_BUDGET,
  );

  // The file list scrolls with the selection: keep the cursor roughly centred
  // rather than letting it walk off the bottom of the viewport.
  const listOffset =
    files.length <= listVisible
      ? 0
      : Math.max(
          0,
          Math.min(
            clampedIndex - Math.floor(listVisible / 2),
            files.length - listVisible,
          ),
        );

  const detailLines = selectedFile?.lines ?? [];
  const isDetail = viewMode === "detail" && Boolean(selectedFile);
  const [contentRows, setContentRows] = useState(0);
  // The file list is one row per file, so its height is already known — the
  // measured row count it reports back is not needed.
  const ignoreMeasuredRows = useCallback(() => {}, []);
  const { scrollOffset, hasMoreAbove, hasMoreBelow, canScroll } = useLineScroll(
    {
      totalLines: isDetail ? contentRows : 0,
      visibleCount: detailVisible,
      lineStep: 1,
      resetKey: `${activeIndex}:${selectedFile?.path ?? ""}`,
    },
  );

  useInput((input, key) => {
    if (key.escape) {
      if (isDetail) {
        setViewMode("list");
      } else {
        onCancel();
      }
      return;
    }

    if (isDetail) return;

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, clampedIndex - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(
        Math.max(0, Math.min(files.length - 1, clampedIndex + 1)),
      );
      return;
    }
    if (key.return && selectedFile) {
      setViewMode("detail");
      return;
    }
    if (key.leftArrow) {
      setSourceIndex(Math.max(0, activeIndex - 1));
      setSelectedIndex(0);
      return;
    }
    if (key.rightArrow) {
      setSourceIndex(Math.min(sources.length - 1, activeIndex + 1));
      setSelectedIndex(0);
    }
  });

  const header = (
    <Box>
      <Text color="cyan" bold>
        {sourceLabel(activeSource)}
      </Text>
      <Text dimColor> {sourceSubLabel(activeSource)}</Text>
      {sources.length > 1 && (
        <Text dimColor>
          {"  "}
          {activeIndex + 1}/{sources.length}
        </Text>
      )}
    </Box>
  );

  if (isDetail && selectedFile) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        {header}
        <Box>
          <Text bold>{selectedFile.path}</Text>
          {selectedFile.additions > 0 && (
            <Text color="green"> +{selectedFile.additions}</Text>
          )}
          {selectedFile.deletions > 0 && (
            <Text color="red"> -{selectedFile.deletions}</Text>
          )}
          {selectedFile.truncated && <Text dimColor> (truncated)</Text>}
        </Box>
        {hasMoreAbove && <Text dimColor>↑ {scrollOffset} more</Text>}
        <ScrolledContent
          visibleRows={detailVisible}
          scrollOffset={scrollOffset}
          onMeasuredRows={setContentRows}
        >
          {detailLines.length > 0 ? (
            detailLines.map((line, index) => (
              <Box key={index}>
                <Text color={lineColor(line)}>
                  {linePrefix(line)}
                  {line.text || " "}
                </Text>
              </Box>
            ))
          ) : (
            <Text dimColor>{selectedFile.note ?? "No diff content"}</Text>
          )}
        </ScrolledContent>
        {hasMoreBelow && (
          <Text dimColor>
            ↓ {Math.max(0, contentRows - scrollOffset - detailVisible)} more
          </Text>
        )}
        <Text dimColor>
          {canScroll ? "PgUp/PgDn page · Ctrl+u/d half page · " : ""}
          Esc back
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      {header}
      <Box>
        {activeSource?.kind === "workspace" &&
        workspace.status === "loading" ? (
          <Text dimColor>Loading changes…</Text>
        ) : activeSource?.kind === "workspace" &&
          workspace.status === "error" ? (
          <Text color="red">{workspace.message}</Text>
        ) : files.length === 0 ? (
          <Text dimColor>
            {(activeSource?.kind === "workspace" &&
              workspace.status === "ready" &&
              workspace.note) ||
              "No changed files"}
          </Text>
        ) : (
          <Text dimColor>
            {files.length} {files.length === 1 ? "file" : "files"} changed
            {stats.additions > 0 && (
              <Text color="green"> +{stats.additions}</Text>
            )}
            {stats.deletions > 0 && (
              <Text color="red"> -{stats.deletions}</Text>
            )}
          </Text>
        )}
      </Box>
      <ScrolledContent
        visibleRows={listVisible}
        scrollOffset={listOffset}
        onMeasuredRows={ignoreMeasuredRows}
      >
        {files.map((file, index) => {
          const isSelected = index === clampedIndex;
          return (
            <Box key={`${file.path}:${index}`} flexDirection="row">
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
                wrap="truncate-middle"
              >
                {isSelected ? "▶ " : "  "}
                {file.path}
              </Text>
              <Box flexGrow={1} />
              <Text>
                {file.binary ? (
                  <Text dimColor> binary</Text>
                ) : (
                  <>
                    {file.additions > 0 && (
                      <Text color="green"> +{file.additions}</Text>
                    )}
                    {file.deletions > 0 && (
                      <Text color="red"> -{file.deletions}</Text>
                    )}
                  </>
                )}
              </Text>
            </Box>
          );
        })}
      </ScrolledContent>
      <Text dimColor>
        ↑/↓ select · Enter view
        {sources.length > 1 ? " · ←/→ switch source" : ""} · Esc close
      </Text>
    </Box>
  );
};

DiffManager.displayName = "DiffManager";
