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

interface StoreData {
  configuration: DesktopConfigData;
  recentWorkdirs: string[];
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
      };
    } catch {
      // Missing or corrupt file — start fresh (loadWaveConfigFromFile precedent).
      return { configuration: {}, recentWorkdirs: [] };
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
}
