import * as path from "node:path";
import { execFileSyncHidden } from "../utils/execFileHidden.js";
import type {
  ModConfigKind,
  ModConfigRow,
  ModConfigValue,
  ModSessionRepo,
} from "../types/mods.js";

/**
 * 合并后的配置 → `/config` 菜单的若干行（`$.config.list()`，spec「配了哪些、
 * 能调什么、有谁在跑」）。
 *
 * 只列**能变成一行的键**：标量（布尔 / 数字 / 字符串）与字符串数组。对象段
 * （`env`、`permissions`、`mcpServers`）不是一行，跳过 —— 社区的读法是
 * `find(row => row.key === "theme")`，给一堆 O 段只会让它们更难找。
 *
 * `isLocked` 的判据：**本地三层都没有这个键，但生效配置里有**。那说明它来自
 * `AgentOptions` / Remote 这类上层，本机的 `settings.json` 改不动它 —— 菜单
 * 显示值但拒绝改，就是这个意思。
 */
export function buildConfigRows(options: {
  /** `configurationService.getCurrentConfiguration()`：合并后的生效值。 */
  merged: Record<string, unknown> | null;
  /** 本地三层（user / project / local）出现过的顶层键。 */
  localKeys: ReadonlySet<string>;
}): ModConfigRow[] {
  const rows: ModConfigRow[] = [];
  for (const [key, raw] of Object.entries(options.merged ?? {})) {
    const value = configValueOf(raw);
    if (value === undefined) continue;
    const kind = configKindOf(value);
    rows.push({
      key,
      label: key,
      kind,
      value,
      ...(kind === "choice" ? { options: value as readonly string[] } : {}),
      provider: { plugin: "engine", tier: "core" },
      isLocked: !options.localKeys.has(key),
    });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** 一个配置值能不能成为一行；不能（对象、混合数组、null）就给 `undefined`。 */
function configValueOf(value: unknown): ModConfigValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return undefined;
}

function configKindOf(value: ModConfigValue): ModConfigKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "choice";
  return "text";
}

/**
 * 会话所在的 git 仓库（`$.session.repo()`，spec「会话事实」）。
 *
 * 探测基准是**会话工作根**：`cd` 进子目录不该让插件以为换了仓库，而进工作树
 * 是真的换了地方，该跟。不在仓库里给 `null`，不抛错 —— 社区写法是 `?.root`。
 *
 * 每次现读（不缓存）：用户可能在会话中间 `git init` 或改 remote。
 */
export function detectSessionRepo(cwd: string): ModSessionRepo | null {
  let root: string;
  try {
    root = execFileSyncHidden("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  if (root.length === 0) return null;

  let remote: string | null = null;
  try {
    const url = execFileSyncHidden(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (url.length > 0) remote = url;
  } catch {
    // 没有 remote 是正常状态：本地 init 的仓库、还没加远端的都是这样。
  }
  return {
    root: path.resolve(root),
    remote,
    // 我们不分「自己的仓库」与「别人的仓库」：那套 allowlist 跟着发行方走，
    // 我们的发行方不维护它，恒 false 比编一个名单诚实。
    internal: false,
    name: null,
  };
}
