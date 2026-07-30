import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

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

/** Session index entry — one per desktop-created session (FR-024). */
export interface SessionIndexEntry {
  sessionId: string;
  title: string;
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
  };
}

interface StoreData {
  configuration: DesktopConfigData;
  recentWorkdirs: string[];
  sessions: SessionIndexEntry[];
}

const MAX_RECENT_WORKDIRS = 10;

export class ConfigStore {
  private filePath: string;
  private data: StoreData;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), 'wave-desktop.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      return {
        configuration: parsed.configuration ?? {},
        recentWorkdirs: Array.isArray(parsed.recentWorkdirs)
          ? parsed.recentWorkdirs.filter((d): d is string => typeof d === 'string')
          : [],
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions
              .filter(
                (s): s is SessionIndexEntry =>
                  typeof s === 'object' && s !== null && typeof s.sessionId === 'string',
              )
              // Entries persisted before createdAt existed fall back to their
              // last activity time, preserving the previously visible order.
              .map((s) => ({ ...s, createdAt: typeof s.createdAt === 'number' ? s.createdAt : s.lastActiveAt }))
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
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[Wave Desktop] Failed to persist config:', err);
    }
  }

  getConfiguration(): DesktopConfigData {
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

  /** Push a directory to the front of the recent list (MRU, deduped). */
  addRecentWorkdir(dir: string): void {
    this.data.recentWorkdirs = [
      dir,
      ...this.data.recentWorkdirs.filter((d) => d !== dir),
    ].slice(0, MAX_RECENT_WORKDIRS);
    this.save();
  }

  getRecentWorkdirs(): string[] {
    return [...this.data.recentWorkdirs];
  }

  removeRecentWorkdir(dir: string): void {
    this.data.recentWorkdirs = this.data.recentWorkdirs.filter((d) => d !== dir);
    this.save();
  }

  // ── Session index (FR-024) ──────────────────────────────────────

  getSessionIndex(): SessionIndexEntry[] {
    return this.data.sessions.map((s) => ({ ...s }));
  }

  /** Register or update a session in the index. */
  upsertSession(entry: SessionIndexEntry): void {
    const idx = this.data.sessions.findIndex((s) => s.sessionId === entry.sessionId);
    if (idx >= 0) {
      this.data.sessions[idx] = entry;
    } else {
      this.data.sessions.push(entry);
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
