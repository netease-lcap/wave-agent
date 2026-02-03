import fs from "fs";
import { PROMPT_HISTORY_FILE, DATA_DIRECTORY } from "./constants.js";
import { logger } from "./globalLogger.js";
import { PromptEntry } from "../types/history.js";

/**
 * Ensure data directory exists
 */
const ensureDataDirectory = (): void => {
  try {
    if (!fs.existsSync(DATA_DIRECTORY)) {
      fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    }
  } catch (error) {
    logger.debug("Failed to create data directory:", error);
  }
};

const MAX_HISTORY_ENTRIES = 1000;

export class PromptHistoryManager {
  /**
   * Add a new prompt to history
   */
  static async addEntry(prompt: string): Promise<void> {
    try {
      if (!prompt.trim()) return;

      ensureDataDirectory();
      const entry: PromptEntry = {
        prompt,
        timestamp: Date.now(),
      };

      const line = JSON.stringify(entry) + "\n";
      await fs.promises.appendFile(PROMPT_HISTORY_FILE, line, "utf-8");

      // Periodically trim history file to prevent it from growing too large
      // We do this randomly (1 in 50 chance) to avoid performance hit on every entry
      if (Math.random() < 0.02) {
        await this.trimHistory();
      }
    } catch (error) {
      logger.debug("Failed to add prompt to history:", error);
    }
  }

  /**
   * Trim history file to MAX_HISTORY_ENTRIES
   */
  private static async trimHistory(): Promise<void> {
    try {
      if (!fs.existsSync(PROMPT_HISTORY_FILE)) return;

      const data = await fs.promises.readFile(PROMPT_HISTORY_FILE, "utf-8");
      const lines = data.split("\n").filter((line) => line.trim());

      if (lines.length > MAX_HISTORY_ENTRIES * 1.2) {
        const trimmedLines = lines.slice(-MAX_HISTORY_ENTRIES);
        await fs.promises.writeFile(
          PROMPT_HISTORY_FILE,
          trimmedLines.join("\n") + "\n",
          "utf-8",
        );
      }
    } catch (error) {
      logger.debug("Failed to trim prompt history:", error);
    }
  }

  /**
   * Get all history entries
   */
  static async getHistory(): Promise<PromptEntry[]> {
    try {
      if (!fs.existsSync(PROMPT_HISTORY_FILE)) {
        return [];
      }

      const data = await fs.promises.readFile(PROMPT_HISTORY_FILE, "utf-8");
      const lines = data.split("\n").filter((line) => line.trim());

      const entries: PromptEntry[] = lines
        .map((line) => {
          try {
            return JSON.parse(line) as PromptEntry;
          } catch {
            logger.debug("Failed to parse history line:", line);
            return null;
          }
        })
        .filter((entry): entry is PromptEntry => entry !== null);

      // Deduplicate by prompt, keeping the most recent one
      const uniqueEntries: PromptEntry[] = [];
      const seenPrompts = new Set<string>();

      // Process from newest to oldest
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!seenPrompts.has(entry.prompt)) {
          uniqueEntries.push(entry);
          seenPrompts.add(entry.prompt);
        }
      }

      return uniqueEntries;
    } catch (error) {
      logger.debug("Failed to load prompt history:", error);
      return [];
    }
  }

  /**
   * Search history by query
   */
  static async searchHistory(query: string): Promise<PromptEntry[]> {
    try {
      const history = await this.getHistory();
      if (!query.trim()) {
        return history;
      }

      const normalizedQuery = query.toLowerCase();
      return history.filter((entry) =>
        entry.prompt.toLowerCase().includes(normalizedQuery),
      );
    } catch (error) {
      logger.debug("Failed to search prompt history:", error);
      return [];
    }
  }
}
