import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { generateRandomName } from "../utils/nameGenerator.js";
import type { Logger } from "../types/core.js";

/**
 * Manages plan files for plan mode
 */
export class PlanManager {
  private planDir: string;

  constructor(private logger?: Logger) {
    this.planDir = path.join(os.homedir(), ".wave", "plans");
  }

  /**
   * Ensures the plan directory exists and generates a new plan file path with a random name
   */
  public async getOrGeneratePlanFilePath(): Promise<{
    path: string;
    name: string;
  }> {
    try {
      await fs.mkdir(this.planDir, { recursive: true });
    } catch (error) {
      this.logger?.error(
        `Failed to create plan directory: ${this.planDir}`,
        error,
      );
      throw error;
    }
    const name = generateRandomName();
    const filePath = path.join(this.planDir, `${name}.md`);
    this.logger?.info(`Generated plan file path: ${filePath}`);
    return { path: filePath, name };
  }

  /**
   * Returns the directory where plan files are stored
   */
  public getPlanDir(): string {
    return this.planDir;
  }
}
