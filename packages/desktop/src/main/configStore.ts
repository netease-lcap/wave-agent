import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { LOCAL_HOST } from "./sshHosts";

/**
 * App-level configuration persisted by the desktop host (the VSCE extension
 * keeps these in context.globalState; we use a JSON file in userData).
 */
export interface DesktopConfigData {
  apiKey?: string;
  headers?: string;
  baseURL?: string;
  model?: string;
  fastModel?: string;
  language?: string;
  serverUrl?: string;
}

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

interface StoreData {
  configuration: DesktopConfigData;
  /** Disk form: WorkdirRef, or legacy plain strings migrated to {host:'local', path} on load. */
  recentWorkdirs: Array<string | WorkdirRef>;
  sessions: SessionIndexEntry[];
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
      };
    } catch {
      // Missing or corrupt file — start fresh (loadWaveConfigFromFile precedent).
      return { configuration: {}, recentWorkdirs: [], sessions: [] };
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
    // language defaults to 'Chinese' to match the VSCE extension
    // (configurationService `|| 'Chinese'`) and the JetBrains plugin
    // (WavePluginService default). Without this, a fresh desktop install
    // sends an undefined language, so the system prompt never injects the
    // `# Language` directive and the model replies in its own default.
    const config = { ...this.data.configuration };
    if (!config.language) config.language = "Chinese";
    return config;
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
