import type { MessageInjector } from "./messageInjector.js";

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
 * reply keyed by the directory it listed. Neither a demo nor an e2e run has a
 * host to answer, so without this the tree sits on 「正在加载…」 forever — the
 * docs images would show a broken tree, and the filter case would have no rows
 * to come back to.
 *
 * Call it once the panel is open (the tree's listener lives inside the pane).
 * Listing more levels than the pane asked for is harmless: a level is rendered
 * where it belongs, and a request for a level that is already there does not
 * clobber it.
 *
 * 只给 demo 用：单栏布局里面板走未打标签的窗口级通道。分屏/桌面宿主里面板实例
 * 只收带自己 paneId 的回包，那边要按请求回（见 desktop-file-panel.e2e.ts 的
 * `replyDirListing`）。
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
