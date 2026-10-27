import type { OpenFileTab, PanelTab } from "../types";

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

/** `a/b/c.ts` → `c.ts` — what a tab shows when the name is unique. */
export const fileName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1) || path;
