import type { OpenFileTab, PanelTab } from "../types";
import { baseNameOf } from "./fileTreePaths";
import { toRelativePath } from "./messageUtils";

/**
 * The file panel's own tab strip (spec desktop-file-panel.md「文件面板已打开文件
 * 的标签」). All of a panel's file state lives in `openFiles` + `activeFileId` on
 * the first-level file tab; there is deliberately no second "current file" field,
 * so "the open list" and "the one being shown" cannot drift apart.
 */

/** The file currently shown by a file panel tab (undefined = none active). */
export const activeFileOf = (
  tab: PanelTab | undefined,
): OpenFileTab | undefined =>
  tab && tab.kind === "file"
    ? tab.openFiles?.find((f) => f.id === tab.activeFileId)
    : undefined;

/** The panel's open files in strip order (empty for non-file tabs). */
export const openFilesOf = (tab: PanelTab | undefined): OpenFileTab[] =>
  tab && tab.kind === "file" ? (tab.openFiles ?? []) : [];

/** Patch one open file entry by id, leaving the rest of the tab alone. */
export const patchOpenFile = (
  tab: PanelTab,
  fileId: string,
  patch: (file: OpenFileTab) => OpenFileTab,
): PanelTab => {
  if (tab.kind !== "file" || !tab.openFiles) return tab;
  let changed = false;
  const openFiles = tab.openFiles.map((f) => {
    if (f.id !== fileId) return f;
    const next = patch(f);
    if (next !== f) changed = true;
    return next;
  });
  return changed ? { ...tab, openFiles } : tab;
};

/** Patch one open file entry by path (the identity the host replies carry). */
export const patchOpenFileByPath = (
  tab: PanelTab,
  path: string,
  patch: (file: OpenFileTab) => OpenFileTab,
): PanelTab => {
  const file = openFilesOf(tab).find((f) => f.path === path);
  return file ? patchOpenFile(tab, file.id, patch) : tab;
};

/** Every open file across every file panel tab in the conversation. */
export const allOpenFiles = (tabs: PanelTab[]): OpenFileTab[] =>
  tabs.flatMap((t) => openFilesOf(t));

/**
 * What one strip tab shows (spec desktop-file-panel.md 场景 4).
 *
 * 口径对齐 Claude 桌面端 Code 的文件标签条：正文永远是裸文件名，重名时才在名字
 * 后面追加一段灰色小字 —— 该名字下「能把彼此区分开的最短目录尾巴」，而不是整条
 * 相对路径。所以 `/repo/src/index.ts` + `/repo/test/index.ts` 是
 * `index.ts src` / `index.ts test`（区分点紧贴名字，宽度只要几个字符），只有
 * `a/x/index.ts` + `b/x/index.ts` 这种才升到 `a/x` / `b/x`。
 */
export interface FileTabLabel {
  /** 裸文件名。 */
  name: string;
  /** 重名时才有的区分后缀（最短唯一目录尾巴）；区分不出来时为 undefined。 */
  suffix?: string;
  /** 悬浮/「更多文件」第二行用的目录，相对 workdir；文件在工作目录根时 undefined。 */
  dir?: string;
  /** 整条相对路径，标签悬浮提示用（工作目录之外回落绝对路径）。 */
  relativePath: string;
}

/** 目录的段数组，保留根标记以便还原整条路径（`/a/b` → `["", "a", "b"]`）。 */
const dirSegments = (dir: string): string[] => {
  const segments = dir.split("/").filter((segment) => segment !== "");
  return dir.startsWith("/") ? ["", ...segments] : segments;
};

const sameSegments = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((segment, index) => segment === b[index]);

/** 段数组的首段是不是根标记（`""` = posix 根、`"C:"` = win32 盘根）。 */
const isRoot = (segment: string | undefined): boolean =>
  segment !== undefined &&
  (segment === "" || segment === "/" || /^[A-Za-z]:$/.test(segment));

/**
 * 最短的、与其他同名文件都不重复的尾部目录段。`own` 为空（文件就在工作目录根）
 * 或所有同名文件都在同一目录时返回 undefined —— 那种情况加什么后缀都区分不了。
 */
const shortestDistinctSuffix = (
  own: string[],
  others: string[][],
): string | undefined => {
  if (own.length === 0) return undefined;
  if (others.every((other) => sameSegments(other, own))) return undefined;
  for (let take = 1; take < own.length; take++) {
    const tail = own.slice(-take).join("/");
    if (others.every((other) => other.slice(-take).join("/") !== tail)) {
      // 尾巴已经等于整条目录、且首段是根标记时保留根，别把 `/src` 退成 `src`。
      return take === own.length - 1 && isRoot(own[0]) ? own.join("/") : tail;
    }
  }
  return own.join("/") || "/";
};

/**
 * 一组打开文件的标签文案，按绝对路径（标签的身份）索引。
 *
 * 只有同名 ≥2 的才计算后缀，唯一文件名原样只给名字。
 */
export const fileTabLabels = (
  paths: string[],
  workdir?: string,
): Map<string, FileTabLabel> => {
  interface Entry {
    path: string;
    name: string;
    relativePath: string;
    dir?: string;
    segments: string[];
  }

  const entries: Entry[] = paths.map((path) => {
    const relativePath = toRelativePath(path, workdir);
    const cut = relativePath.lastIndexOf("/");
    const dir = cut < 0 ? undefined : relativePath.slice(0, cut) || "/";
    return {
      path,
      name: baseNameOf(path),
      relativePath,
      dir,
      segments: dir === undefined ? [] : dirSegments(dir),
    };
  });

  const byName = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = byName.get(entry.name);
    if (group) group.push(entry);
    else byName.set(entry.name, [entry]);
  }

  const labels = new Map<string, FileTabLabel>();
  for (const entry of entries) {
    const group = byName.get(entry.name) ?? [];
    const suffix =
      group.length > 1
        ? shortestDistinctSuffix(
            entry.segments,
            group
              .filter((other) => other !== entry)
              .map((other) => other.segments),
          )
        : undefined;
    labels.set(entry.path, {
      name: entry.name,
      suffix,
      dir: entry.dir,
      relativePath: entry.relativePath,
    });
  }
  return labels;
};
