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
  private currentPlanFilePath: string | undefined;

  constructor(private logger?: Logger) {
    this.planDir = path.join(os.homedir(), ".wave", "plans");
  }

  /**
   * Ensures the plan directory exists and returns the current plan file path or generates a new one
   */
  public async getOrGeneratePlanFilePath(): Promise<{
    path: string;
    name: string;
  }> {
    if (this.currentPlanFilePath) {
      const name = path.basename(this.currentPlanFilePath, ".md");
      return { path: this.currentPlanFilePath, name };
    }

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
    this.currentPlanFilePath = filePath;
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
