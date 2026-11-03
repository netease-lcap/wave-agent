/**
 * 「最近目录」列表项的两行式显示：第一行目录名，第二行父路径。
 *
 * 分隔符必须**两种都认**：会话目录保留机器自己的拼写（Windows 上是系统原生
 * `C:\Users\…`，见 DesktopSidebar 的 `dirName`），而 worktree 会话的目录来自
 * `git worktree list`（正斜杠）。只按 `/` 切时反斜杠那条整条成为一个片段，
 * 目录名位置会把完整路径漏出来——这是桌面端修过一次、远控页新建对话弹窗又
 * 各写一遍的老坑，因此两边共用这一个函数。
 */
export function splitWorkdir(dir: string): { name: string; parent: string } {
  const trimmed = dir.replace(/[\\/]+$/, "");
  // 盘根（`C:\`）是唯一的例外：去掉尾部分隔符就剩下 `C:`，那不是一条路径。
  const path = /^[A-Za-z]:$/.test(trimmed) ? dir : trimmed;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  // 没有分隔符（或整条就是分隔符）：它自己既是名字，也没有父路径。
  if (cut < 0) return { name: dir, parent: "" };
  const name = path.slice(cut + 1) || dir;
  const rawParent = path.slice(0, cut + 1);
  const parent = /^[A-Za-z]:[\\/]$/.test(rawParent)
    ? rawParent
    : rawParent.replace(/[\\/]+$/, "");
  return { name, parent };
}
