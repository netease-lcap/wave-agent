/**
 * Bash command history management module
 * Used for persistent storage and searching of bash commands executed by users
 */

import fs from "fs";
import { BASH_HISTORY_FILE, DATA_DIRECTORY } from "./constants.js";
import { logger } from "./globalLogger.js";

export interface BashHistoryEntry {
  command: string;
  timestamp: number;
  workdir: string;
}

export interface BashHistory {
  commands: BashHistoryEntry[];
  version: number;
}

const HISTORY_VERSION = 1;
const MAX_HISTORY_SIZE = 1000;

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

/**
 * Load bash history
 */
export const loadBashHistory = (): BashHistory => {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(BASH_HISTORY_FILE)) {
      return {
        commands: [],
        version: HISTORY_VERSION,
      };
    }

    const data = fs.readFileSync(BASH_HISTORY_FILE, "utf-8");
    const history: BashHistory = JSON.parse(data);

    // Version compatibility check
    if (history.version !== HISTORY_VERSION) {
      logger.debug("Bash history version mismatch, resetting history");
      return {
        commands: [],
        version: HISTORY_VERSION,
      };
    }

    return history;
  } catch (error) {
    logger.debug("Failed to load bash history:", error);
    return {
      commands: [],
      version: HISTORY_VERSION,
    };
  }
};

/**
 * Save bash history
 */
export const saveBashHistory = (history: BashHistory): void => {
  try {
    // Skip saving to file when in test environment
    if (process.env.NODE_ENV === "test") {
      logger.debug("Skipping bash history save in test environment");
      return;
    }

    ensureDataDirectory();

    // Limit history size
    if (history.commands.length > MAX_HISTORY_SIZE) {
      history.commands = history.commands.slice(-MAX_HISTORY_SIZE);
    }

    const data = JSON.stringify(history, null, 2);
    fs.writeFileSync(BASH_HISTORY_FILE, data, "utf-8");
  } catch (error) {
    logger.debug("Failed to save bash history:", error);
  }
};

/**
 * Add command to bash history
 */
export const addBashCommandToHistory = (
  command: string,
  workdir: string,
): void => {
  try {
    const history = loadBashHistory();
    const timestamp = Date.now();

    // Check if it's a duplicate consecutive command to avoid duplicate recording
    const lastCommand = history.commands[history.commands.length - 1];
    if (
      lastCommand &&
      lastCommand.command === command &&
      lastCommand.workdir === workdir
    ) {
      // Update timestamp of the last record
      lastCommand.timestamp = timestamp;
    } else {
      // Add new command record
      history.commands.push({
        command,
        timestamp,
        workdir,
      });
    }

    saveBashHistory(history);
    logger.debug("Added bash command to history:", { command, workdir });
  } catch (error) {
    logger.debug("Failed to add bash command to history:", error);
  }
};

/**
 * Search bash history by keywords
 */
export const searchBashHistory = (
  query: string,
  limit: number = 10,
  workdir: string,
): BashHistoryEntry[] => {
  try {
    const history = loadBashHistory();
    const normalizedQuery = query.toLowerCase().trim();

    let filteredCommands = history.commands;

    // Working directory filter
    filteredCommands = filteredCommands.filter(
      (entry) => entry.workdir === workdir,
    );

    if (!normalizedQuery) {
      // If no search query, return recent commands (deduplicated)
      const deduped = deduplicateCommands(filteredCommands);
      return deduped.slice(0, limit); // Latest first
    }

    // Search by relevance
    const matches = filteredCommands
      .filter((entry) => {
        // Command content matching
        const command = entry.command.toLowerCase();
        return command.includes(normalizedQuery);
      })
      .map((entry) => {
        // Calculate match score
        const command = entry.command.toLowerCase();
        let score = 0;

        // Exact match gets higher score
        if (command.includes(normalizedQuery)) {
          score += 10;
        }

        // Command prefix match gets higher score
        if (command.startsWith(normalizedQuery)) {
          score += 20;
        }

        // Word boundary match gets higher score
        const words = command.split(/\s+/);
        if (words.some((word) => word.startsWith(normalizedQuery))) {
          score += 15;
        }

        // Timestamp influence (newer gets higher score)
        score += entry.timestamp / 1000000; // Normalize timestamp

        return { entry, score };
      })
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .map((item) => item.entry);

    // Deduplicate search results, keep latest record
    const dedupedMatches = deduplicateCommands(matches);
    const result = dedupedMatches.slice(0, limit);

    logger.debug("Bash history search results:", {
      query,
      workdir: process.cwd(),
      originalCount: matches.length,
      dedupedCount: result.length,
    });

    return result;
  } catch (error) {
    logger.debug("Failed to search bash history:", error);
    return [];
  }
};

/**
 * Deduplicate command list, keep latest record for each command
 */
const deduplicateCommands = (
  commands: BashHistoryEntry[],
): BashHistoryEntry[] => {
  const commandMap = new Map<string, BashHistoryEntry>();

  // Iterate through all commands, keep latest record for each
  for (const entry of commands) {
    const existing = commandMap.get(entry.command);
    if (!existing || entry.timestamp > existing.timestamp) {
      commandMap.set(entry.command, entry);
    }
  }

  // Sort by timestamp and return (new to old)
  return Array.from(commandMap.values()).sort(
    (a, b) => b.timestamp - a.timestamp,
  );
};

/**
 * Get recently used bash commands
 */
export const getRecentBashCommands = (
  workdir: string,
  limit: number = 10,
): BashHistoryEntry[] => {
  try {
    const history = loadBashHistory();
    const filtered = history.commands.filter(
      (entry) => entry.workdir === workdir,
    );

    // Return recent commands after deduplication
    const deduped = deduplicateCommands(filtered);
    return deduped.slice(0, limit); // Latest first
  } catch (error) {
    logger.debug("Failed to get recent bash commands:", error);
    return [];
  }
};

/**
 * Clear bash history
 */
export const clearBashHistory = (): void => {
  try {
    const history: BashHistory = {
      commands: [],
      version: HISTORY_VERSION,
    };
    saveBashHistory(history);
    logger.debug("Bash history cleared");
  } catch (error) {
    logger.debug("Failed to clear bash history:", error);
  }
};

/**
 * Get bash command statistics
 */
export const getBashCommandStats = (): {
  totalCommands: number;
  uniqueCommands: number;
  workdirs: string[];
} => {
  try {
    const history = loadBashHistory();
    const uniqueCommands = new Set(
      history.commands.map((entry) => entry.command),
    );
    const workdirs = Array.from(
      new Set(history.commands.map((entry) => entry.workdir)),
    );

    return {
      totalCommands: history.commands.length,
      uniqueCommands: uniqueCommands.size,
      workdirs,
    };
  } catch (error) {
    logger.debug("Failed to get bash command stats:", error);
    return {
      totalCommands: 0,
      uniqueCommands: 0,
      workdirs: [],
    };
  }
};
