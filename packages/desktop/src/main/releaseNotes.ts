/**
 * 变更记录（Release Notes）的归一化：feed 的 `releaseNotes` 是**数组**
 * （`[{ version, note }, …]`，最近若干个版本，服务端倒序，vusion/codechat#50），
 * 宿主按**已装版本**过滤后交给 webview 渲染（spec
 * desktop-distribution.md「更新内容（Release Notes）」场景 5–6、
 * desktop-account.md「更新按钮状态机 S0–S6」场景 5）。
 *
 * 为什么过滤放在宿主而不是 webview：
 * - 版本比较的实现（`parseVersion` / `compareVersions`）本来就住在主进程；
 * - webview 只渲染收到的数组，不需要知道「已装版本是多少」，也不必重复一份比较逻辑。
 *
 * 为什么是数组而不是单值：大量版本只进 beta、永不进 stable。stable 用户跨过若干
 * 只进 beta 的版本时，只有把「比自己新的每个版本的增量」都带到 S4，才看得全
 * 中间的改动；单值只能给出目标版本的增量（详见 desktop-distribution.md 约束 3）。
 *
 * 容错口径：electron-updater 的官方类型是 `string | Array<{ version, note }>` ——
 * 字符串形态包成单元素数组（其他 provider 就是这么给的）；版本号解析不了的项、
 * `note` 为空的项直接丢弃（宁可少展示，也不把别的版本的记录算成本次更新）；
 * 过滤后为空返回 `undefined`，S4 便不渲染记录块。
 */

import { compareVersions, parseVersion } from "./version";

export interface ReleaseNoteEntry {
  version: string;
  note: string;
}

function toEntry(item: unknown): ReleaseNoteEntry | null {
  if (typeof item !== "object" || item === null) return null;
  const { version, note } = item as { version?: unknown; note?: unknown };
  if (typeof version !== "string" || typeof note !== "string") return null;
  const trimmed = note.replace(/\r/g, "").trim();
  if (!trimmed) return null;
  return { version: version.trim(), note: trimmed };
}

/**
 * `UpdateInfo.releaseNotes` → 只含「比已装版本新」的条目，按版本倒序；
 * 没有任何可展示条目时返回 `undefined`（= 不下发，S4 不渲染记录块）。
 *
 * @param releaseNotes electron-updater 给的原值（未知形态一律忽略）
 * @param installedVersion 当前安装的版本（`app.getVersion()`）
 * @param updateVersion 本次要装的版本（字符串形态缺 version 时用它兜底）
 */
export function normalizeReleaseNotes(
  releaseNotes: unknown,
  installedVersion: string,
  updateVersion: string,
): ReleaseNoteEntry[] | undefined {
  const installed = parseVersion(installedVersion);
  if (!installed) return undefined;

  const raw = Array.isArray(releaseNotes)
    ? releaseNotes
    : typeof releaseNotes === "string"
      ? [{ version: updateVersion, note: releaseNotes }]
      : [];
  if (raw.length === 0) return undefined;

  const entries: Array<{
    version: string;
    parsed: NonNullable<ReturnType<typeof parseVersion>>;
    note: string;
  }> = [];
  for (const item of raw) {
    const entry = toEntry(item);
    if (!entry) continue;
    const parsed = parseVersion(entry.version);
    // 版本号不认识 → 无法判断「是否比已装版本新」，丢弃而不是猜
    if (!parsed) continue;
    if (compareVersions(parsed, installed) <= 0) continue;
    entries.push({ ...entry, parsed });
  }
  if (entries.length === 0) return undefined;

  entries.sort((a, b) => compareVersions(b.parsed, a.parsed));
  return entries.map(({ version, note }) => ({ version, note }));
}
