import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { generateRandomName } from "../utils/nameGenerator.js";

import { Container } from "../utils/container.js";

/**
 * Manages plan files for plan mode
 */
import { logger } from "../utils/globalLogger.js";

export class PlanManager {
  private planDir: string;
  private currentPlanFilePath: string | null = null;

  constructor(private container: Container) {
    this.planDir = path.join(os.homedir(), ".wave", "plans");
  }

  /**
   * Ensures the plan directory exists and generates a new plan file path with a random name
   */
  public async getOrGeneratePlanFilePath(seed?: string): Promise<{
    path: string;
    name: string;
  }> {
    try {
      await fs.mkdir(this.planDir, { recursive: true });
    } catch (error) {
      logger?.error(`Failed to create plan directory: ${this.planDir}`, error);
      throw error;
    }
    const name = generateRandomName(seed);
    const filePath = path.join(this.planDir, `${name}.md`);

    if (this.currentPlanFilePath !== filePath) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (
          error instanceof Error &&
          (error as Error & { code?: string }).code !== "ENOENT"
        ) {
          logger?.error(
            `Failed to remove existing plan file: ${filePath}`,
            error,
          );
        }
      }
      this.currentPlanFilePath = filePath;
    }

    logger?.info(`Generated plan file path: ${filePath}`);
    return { path: filePath, name };
  }

  /**
   * Returns the directory where plan files are stored
   */
  public getPlanDir(): string {
    return this.planDir;
  }
}
