import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import type {
  UserPreferenceKey,
  UserPreferenceSource,
} from "wave-agent-sdk/host";
import { LOCAL_HOST } from "./sshHosts";

/**
 * 桌面本地存储的键。**只剩服务地址**：用户偏好都不落这里——
 * **对话模型**经底栏模型选择器走宿主 RPC（`getConfiguredModels` / `setModel`），
 * 用户偏好（语言 / 上下文长度 / 自动记忆 / **补全模型与补全开关**）的唯一落点是
 * 用户级 `~/.wave/settings.json`——补全模型虽与模型相关，但它是配置文件里的一
 * 个用户偏好键（顶层 `completionModel`，spec ui/code-completion.md 故事 4），
 * 随本载荷读写。
 * `serverUrl` 由 CLI 的 `getAuthStatus` 解析（宿主只缓存，用于拼更新 feed URL）。
 *
 * 设置页配置回包载荷只承载用户偏好键（见 `ConfigurationData`）。
 */
export interface DesktopConfigData {
  /**
   * 服务端地址。两条路径共用同一字段名：①本地缓存（`wave-desktop.json`，由 CLI 的
   * `getAuthStatus` 解析写入，仅用于拼更新 feed URL）；②设置页载荷里的用户偏好
   * （落会话进程用户级 `~/.wave/settings.json` 的 `env.WAVE_SERVER_URL`，经
   * `updateUserSettings` RPC）。二者是同一概念的不同落点。
   */
  serverUrl?: string;
  /**
   * 用户偏好：AI 回复语言。落点唯一为用户级 `~/.wave/settings.json`（读写经
   * `getUserSettings` / `updateUserSettings` RPC），**不写入**本存储。
   */
  language?: string;
  /** 用户偏好：上下文长度（K 值，16–1000），落 `env.WAVE_MAX_INPUT_TOKENS`。 */
  contextLength?: number;
  /** 用户偏好：是否开启自动记忆提取。 */
  autoMemoryEnabled?: boolean;
  /** 用户偏好：自动记忆提取轮次频率（1–100）。 */
  autoMemoryFrequency?: number;
  /**
   * 用户偏好：行内补全使用的模型（settings.json 顶层 `completionModel`，未设置时
   * 回退快速模型）。**对话模型**不在本载荷里（那是模型选择器的会话级 RPC），
   * 补全模型是配置文件里的一个用户偏好键（spec ui/code-completion.md 故事 4）。
   */
  completionModel?: string;
  /** 用户偏好：是否启用行内补全（顶层 `completionEnabled`，缺省为开）。 */
  completionEnabled?: boolean;
  /** 用户偏好：是否启用下一步编辑建议（顶层 `nextEditEnabled`，缺省为关）。 */
  nextEditEnabled?: boolean;
  /** 用户偏好：是否启用企业知识库（顶层 `enableKnowledgeBase`，缺省为关）。 */
  enableKnowledgeBase?: boolean;
  /**
   * 用户偏好每个键的**来源层**（`remote` / `user` / `env` / `default`）：回包
   * 里带上它，设置页才能把被组织配置（Remote）覆盖的键显示为「生效值 + 置灰」
   * 而不是回退成用户文件里的值（spec core/agent-config.md 边界说明
   * 「用户偏好的层与来源」）。与用户偏好同源（`getUserSettings` 回包），
   * **不写入**本存储。
   */
  preferenceSources?: Partial<Record<UserPreferenceKey, UserPreferenceSource>>;
}

/** App appearance preference — 设置页「全局设置」三态选择（仅桌面端 UI）。 */
export type ThemeSource = "system" | "light" | "dark";

/** 桌面端更新通道 — 设置页「全局设置」「接收 Beta 版更新」开关（仅桌面端 UI）。
 *  stable = codechat 正式 feed（`/api/downloads/desktop/{mac|win}/`）；
 *  beta = 测试 feed（`/api/downloads/desktop-beta/{mac|win}/`，依赖 codechat #33）。 */
export type UpdateChannel = "stable" | "beta";

/**
 * A recent workdir, tagged with the host it lives on. `host` is the ssh config
 * host name, or LOCAL_HOST ('local') for this machine. (host, path) is the
 * identity — the same path on two hosts are distinct entries.
 */
export interface WorkdirRef {
  host: string;
  path: string;
}

/** Session index entry — one per desktop-created session (FR-024). */
export interface SessionIndexEntry {
  sessionId: string;
  title: string;
  /** Host the session runs on ('local' or an ssh config host name). */
  host: string;
  /** Grouping key for the sidebar tree (original repo dir for worktree sessions). */
  workdir: string;
  /** Actual working directory (worktree path for worktree sessions). */
  cwd: string;
  /** Creation time — the sidebar tree sorts by it, so activity never reorders sessions. */
  createdAt: number;
  lastActiveAt: number;
  worktree?: {
    path: string;
    branch: string;
    baseBranch: string;
    repoRoot: string;
    hookBased?: boolean;
  };
}

/**
 * 创作集分类的本机存储（一个账号一份）。
 *
 * 分类是**本机数据**而不是服务端模型（spec desktop-artifacts.md「非功能需求 /
 * 写动作的口径」）：换机器看不到自己的分类，但也不需要服务端改动。`assignments`
 * 是 slug → 分类 id，一个文件最多一个分类；分类被删后残留的 slug 记录无害
 * （渲染时按「分类不存在即不显示」处理）。
 */
export interface ArtifactCategoryRecord {
  categories: Array<{ id: string; name: string }>;
  assignments: Record<string, string>;
}

interface StoreData {
  configuration: DesktopConfigData;
  /** App appearance preference: follow the OS, or force light/dark. Defaults to "system". */
  theme: ThemeSource;
  /** Desktop update feed channel (设置页「接收 Beta 版更新」). Defaults to "stable". */
  updateChannel: UpdateChannel;
  /** Disk form: WorkdirRef, or legacy plain strings migrated to {host:'local', path} on load. */
  recentWorkdirs: Array<string | WorkdirRef>;
  sessions: SessionIndexEntry[];
  /** 创作集分类：按账号（邮箱）隔离命名空间。 */
  artifactCategories?: Record<string, ArtifactCategoryRecord>;
}

const MAX_RECENT_WORKDIRS = 10;

export class ConfigStore {
  private filePath: string;
  private data: StoreData;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(app.getPath("userData"), "wave-desktop.json");
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      return {
        configuration: parsed.configuration ?? {},
        theme: isThemeSource(parsed.theme) ? parsed.theme : "system",
        updateChannel: isUpdateChannel(parsed.updateChannel)
          ? parsed.updateChannel
          : "stable",
        // Legacy plain-string entries (pre-remote) become local-host refs.
        // Deduped on load so older data where one directory was persisted with
        // two slash styles (e.g. `C:\a` and `C:/a`) collapses into one entry.
        recentWorkdirs: Array.isArray(parsed.recentWorkdirs)
          ? dedupeRecentWorkdirs(parsed.recentWorkdirs)
          : [],
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions
              .filter(
                (s): s is SessionIndexEntry =>
                  typeof s === "object" &&
                  s !== null &&
                  typeof s.sessionId === "string",
              )
              // Entries persisted before createdAt existed fall back to their
              // last activity time, preserving the previously visible order.
              // Pre-remote entries carry no host — they were all local.
              .map((s) => ({
                ...s,
                host: s.host ?? LOCAL_HOST,
                createdAt:
                  typeof s.createdAt === "number"
                    ? s.createdAt
                    : s.lastActiveAt,
              }))
          : [],
        // 分类是本机数据：读不出来就按空集合处理，不影响其它字段。
        artifactCategories:
          parsed.artifactCategories &&
          typeof parsed.artifactCategories === "object"
            ? parsed.artifactCategories
            : {},
      };
    } catch {
      // Missing or corrupt file — start fresh (loadWaveConfigFromFile precedent).
      return {
        configuration: {},
        theme: "system",
        updateChannel: "stable",
        recentWorkdirs: [],
        sessions: [],
        artifactCategories: {},
      };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error("[Wave Desktop] Failed to persist config:", err);
    }
  }

  getConfiguration(): DesktopConfigData {
    // 只承载桌面本地配置（模型/快速模型/服务地址）。用户偏好（language /
    // contextLength / autoMemory*）不在本存储：它们落用户级
    // `~/.wave/settings.json` 并随配置回包合并展示（spec 边界「用户偏好不落
    // 桌面本地配置」），因此这里也不再注入 language 默认值。
    return { ...this.data.configuration };
  }

  /**
   * Merge-update: fields explicitly present in `config` are written; absent
   * (undefined) fields keep their stored value — same semantics as the VSCE
   * ConfigurationService.updateConfiguration.
   */
  setConfiguration(config: DesktopConfigData): void {
    const merged: Record<string, unknown> = { ...this.data.configuration };
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    this.data.configuration = merged as DesktopConfigData;
    this.save();
  }

  /** App appearance preference (defaults to following the OS). */
  getThemeSource(): ThemeSource {
    return this.data.theme;
  }

  /** Persist the appearance preference (desktop host applies it to nativeTheme). */
  setThemeSource(source: ThemeSource): void {
    this.data.theme = source;
    this.save();
  }

  /**
   * 创作集分类（本机存储，按账号隔离）。账号取自当前登录用户邮箱；未登录时
   * 读不到列表、也就不会写分类，这里的 fallback 只保证类型安全。
   */
  getArtifactCategories(account: string): ArtifactCategoryRecord {
    const record = this.data.artifactCategories?.[account];
    return {
      categories: Array.isArray(record?.categories)
        ? record.categories.filter(
            (c) => typeof c?.id === "string" && typeof c?.name === "string",
          )
        : [],
      assignments:
        record?.assignments && typeof record.assignments === "object"
          ? { ...record.assignments }
          : {},
    };
  }

  setArtifactCategories(account: string, record: ArtifactCategoryRecord): void {
    this.data.artifactCategories = {
      ...(this.data.artifactCategories ?? {}),
      [account]: record,
    };
    this.save();
  }

  /** Desktop update feed channel (defaults to "stable"). */
  getUpdateChannel(): UpdateChannel {
    return this.data.updateChannel;
  }

  /** Persist the update feed channel (desktop host re-checks against the new feed). */
  setUpdateChannel(channel: UpdateChannel): void {
    this.data.updateChannel = channel;
    this.save();
  }

  /**
   * Push a directory to the front of its host's recent list (MRU, deduped).
   * The list is per-host: the same path on two hosts are distinct entries.
   * Paths are normalized (slash style) before comparing/storing so the same
   * local directory entered with `\` or `/` never shows up twice.
   */
  addRecentWorkdir(ref: WorkdirRef): void {
    const normalized = normalizeWorkdirRef(ref);
    if (!normalized) return;
    const key = (d: string | WorkdirRef): string => {
      const w = normalizeWorkdirRef(d);
      return w ? `${w.host}\u0000${w.path}` : "";
    };
    this.data.recentWorkdirs = [
      normalized,
      ...this.data.recentWorkdirs.filter(
        (d) => key(d) !== `${normalized.host}\u0000${normalized.path}`,
      ),
    ].slice(0, MAX_RECENT_WORKDIRS);
    this.save();
  }

  getRecentWorkdirs(): WorkdirRef[] {
    return this.data.recentWorkdirs
      .map(normalizeWorkdirRef)
      .filter((d): d is WorkdirRef => d !== null);
  }

  /** Paths (MRU) for one host — the picker list shown while that host is selected. */
  getRecentWorkdirsForHost(host: string): string[] {
    return this.getRecentWorkdirs()
      .filter((d) => d.host === host)
      .map((d) => d.path);
  }

  /**
   * Replace one host's cached paths with what that machine just reported.
   *
   * This is the fallback copy, and the machine's own list is the truth (spec
   * core/recent-workdirs.md): mirroring it keeps the fallback free of entries
   * the machine no longer has, and of the worktree paths the machine's own
   * read maps to repository roots — otherwise a host that goes unreachable
   * would show a stale list that no longer matches what it served a minute ago.
   * Other hosts keep their order.
   */
  setRecentWorkdirsForHost(host: string, paths: string[]): void {
    const others = this.getRecentWorkdirs().filter((d) => d.host !== host);
    const next = [
      ...paths.map((path) => normalizeWorkdirRef({ host, path })),
      ...others,
    ].filter((d): d is WorkdirRef => d !== null);
    this.data.recentWorkdirs = next.slice(0, MAX_RECENT_WORKDIRS);
    this.save();
  }

  removeRecentWorkdir(ref: WorkdirRef): void {
    const key = (d: string | WorkdirRef): string => {
      const w = normalizeWorkdirRef(d);
      return w ? `${w.host}\u0000${w.path}` : "";
    };
    this.data.recentWorkdirs = this.data.recentWorkdirs.filter(
      (d) => key(d) !== `${ref.host}\u0000${ref.path}`,
    );
    this.save();
  }

  // ── Session index (FR-024) ──────────────────────────────────────

  getSessionIndex(): SessionIndexEntry[] {
    return this.data.sessions.map((s) => ({ ...s }));
  }

  /** Register or update a session in the index. */
  upsertSession(entry: SessionIndexEntry): void {
    // Defensive normalization: any entry without an explicit host is local.
    const normalized = { ...entry, host: entry.host ?? LOCAL_HOST };
    const idx = this.data.sessions.findIndex(
      (s) => s.sessionId === entry.sessionId,
    );
    if (idx >= 0) {
      this.data.sessions[idx] = normalized;
    } else {
      this.data.sessions.push(normalized);
    }
    this.save();
  }

  /** Update lastActiveAt for a session (called on agent activity). */
  touchSession(sessionId: string, lastActiveAt: number): void {
    const entry = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (entry) {
      entry.lastActiveAt = lastActiveAt;
      this.save();
    }
  }

  /** Remove a session from the index. Returns the removed entry, if found. */
  removeSession(sessionId: string): SessionIndexEntry | undefined {
    const idx = this.data.sessions.findIndex((s) => s.sessionId === sessionId);
    if (idx < 0) return undefined;
    const [removed] = this.data.sessions.splice(idx, 1);
    this.save();
    return removed;
  }
}

/** Accepts either disk form; returns null for malformed entries. */
function normalizeWorkdirRef(
  value: string | WorkdirRef | undefined | null,
): WorkdirRef | null {
  if (typeof value === "string") {
    return value ? { host: LOCAL_HOST, path: normalizeLocalPath(value) } : null;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof value.host === "string" &&
    typeof value.path === "string"
  ) {
    return {
      host: value.host,
      // Remote paths are POSIX and case-sensitive; only local paths on Windows
      // tolerate both slash styles and a trailing separator.
      path:
        value.host === LOCAL_HOST ? normalizeLocalPath(value.path) : value.path,
    };
  }
  return null;
}

/**
 * Dedupe by (host, path) after normalization, keeping the first (MRU-most)
 * occurrence of each directory. Callers pass disk-form arrays; malformed
 * entries are dropped.
 */
function dedupeRecentWorkdirs(
  entries: Array<string | WorkdirRef>,
): WorkdirRef[] {
  const seen = new Set<string>();
  const out: WorkdirRef[] = [];
  for (const raw of entries) {
    const w = normalizeWorkdirRef(raw);
    if (!w) continue;
    const key = `${w.host}\u0000${w.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/**
 * Normalize a local Windows path so equivalent spellings of the same directory
 * compare equal: unify separators (`C:/a` → `C:\a`) and drop a redundant
 * trailing separator (`C:\a\` → `C:\a`, but drive roots keep it). POSIX paths
 * (and remote-host paths, which stay POSIX) are returned unchanged — detection
 * is purely by shape, so this is a no-op on non-Windows spellings everywhere.
 */
function normalizeLocalPath(p: string): string {
  const hasDrive = /^[A-Za-z]:[\\/]/.test(p);
  const hasUnc = /^[\\/]{2}[^\\/]/.test(p);
  if (!hasDrive && !hasUnc) return p;
  const normalized = path.win32.normalize(p);
  // `C:\` (drive root) keeps its separator; everything else drops it.
  return normalized.length > 3 && normalized.endsWith("\\")
    ? normalized.slice(0, -1)
    : normalized;
}

/** Type guard for theme preference values loaded from disk. */
function isThemeSource(value: unknown): value is ThemeSource {
  return value === "system" || value === "light" || value === "dark";
}

/** Type guard for update channel values loaded from disk. */
function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "beta";
}
