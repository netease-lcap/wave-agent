import type { MessageInjector } from "../e2e/utils/messageInjector.js";

/** One row of the panel's directory tree (`FileTreeEntry` in the fixtures). */
export interface SeededTreeEntry {
  name: string;
  type: "dir" | "file";
}

/**
 * Answer the file panel's directory listing.
 *
 * The panel's left column is a lazily loaded tree (spec desktop-file-panel.md
 * 「文件面板工作区目录树」): opening a panel requests the root level, expanding a
 * directory requests that level, and every row waits on a `desktopDirEntries`
 * reply keyed by the directory it listed. A demo has no host to answer, so
 * without this the tree sits on 「正在加载…」 for the whole screenshot — the docs
 * images would show the tree as broken rather than as what it is.
 *
 * Call it once the panel is open (the tree's listener lives inside the pane).
 * Listing more levels than the pane asked for is harmless: a level is rendered
 * where it belongs, and a request for a level that is already there does not
 * clobber it.
 */
export async function seedFileTree(
  injector: MessageInjector,
  levels: Record<string, SeededTreeEntry[]>,
): Promise<void> {
  for (const [path, entries] of Object.entries(levels)) {
    await injector.simulateExtensionMessage("desktopDirEntries", {
      path,
      entries,
      total: entries.length,
    });
  }
}
