/**
 * Bash 命令历史管理模块
 * 用于持久化存储和搜索用户执行过的 bash 命令
 */

import fs from "fs";
import { BASH_HISTORY_FILE, DATA_DIRECTORY } from "./constants.js";
import { logger } from "./logger.js";

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
 * 确保数据目录存在
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
 * 加载bash历史
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

    // 版本兼容性检查
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
 * 保存bash历史
 */
export const saveBashHistory = (history: BashHistory): void => {
  try {
    // Skip saving to file when in test environment
    if (process.env.NODE_ENV === "test") {
      logger.debug("Skipping bash history save in test environment");
      return;
    }

    ensureDataDirectory();

    // 限制历史记录大小
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
 * 添加命令到bash历史记录
 */
export const addBashCommandToHistory = (
  command: string,
  workdir: string,
): void => {
  try {
    // 过滤系统生成的命令，不添加到历史记录中
    if (command.startsWith("git add . && git commit -m")) {
      logger.debug("Skipping system-generated command:", { command, workdir });
      return;
    }

    const history = loadBashHistory();
    const timestamp = Date.now();

    // 检查是否是重复的连续命令，避免重复记录
    const lastCommand = history.commands[history.commands.length - 1];
    if (
      lastCommand &&
      lastCommand.command === command &&
      lastCommand.workdir === workdir
    ) {
      // 更新最后一条记录的时间戳
      lastCommand.timestamp = timestamp;
    } else {
      // 添加新的命令记录
      history.commands.push({
        command,
        timestamp,
        workdir,
      });
    }

    saveBashHistory(history);
    logger.debug("Added bash command to history:", {
      command,
      workdir,
    });
  } catch (error) {
    logger.debug("Failed to add bash command to history:", error);
  }
};

/**
 * 根据关键字搜索bash历史
 */
export const searchBashHistory = (
  query: string,
  limit: number = 10,
): BashHistoryEntry[] => {
  try {
    const history = loadBashHistory();
    const normalizedQuery = query.toLowerCase().trim();

    let filteredCommands = history.commands;

    // 工作目录过滤 - 默认过滤当前工作目录
    filteredCommands = filteredCommands.filter(
      (entry) => entry.workdir === process.cwd(),
    );

    if (!normalizedQuery) {
      // 如果没有查询词，返回最近的命令（去重后）
      const deduped = deduplicateCommands(filteredCommands);
      return deduped.slice(-limit).reverse(); // 最新的在前面
    }

    // 按相关性搜索
    const matches = filteredCommands
      .filter((entry) => {
        // 命令内容匹配
        const command = entry.command.toLowerCase();
        return command.includes(normalizedQuery);
      })
      .map((entry) => {
        // 计算匹配得分
        const command = entry.command.toLowerCase();
        let score = 0;

        // 精确匹配得分更高
        if (command.includes(normalizedQuery)) {
          score += 10;
        }

        // 命令开头匹配得分更高
        if (command.startsWith(normalizedQuery)) {
          score += 20;
        }

        // 单词边界匹配得分更高
        const words = command.split(/\s+/);
        if (words.some((word) => word.startsWith(normalizedQuery))) {
          score += 15;
        }

        // 时间戳影响（越新得分越高）
        score += entry.timestamp / 1000000; // 归一化时间戳

        return { entry, score };
      })
      .sort((a, b) => b.score - a.score) // 按得分降序排列
      .map((item) => item.entry);

    // 对搜索结果去重，保留最新的记录
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
 * 去重命令列表，保留每个命令的最新记录
 */
const deduplicateCommands = (
  commands: BashHistoryEntry[],
): BashHistoryEntry[] => {
  const commandMap = new Map<string, BashHistoryEntry>();

  // 遍历所有命令，保留每个命令的最新记录
  for (const entry of commands) {
    const existing = commandMap.get(entry.command);
    if (!existing || entry.timestamp > existing.timestamp) {
      commandMap.set(entry.command, entry);
    }
  }

  // 按时间戳排序返回
  return Array.from(commandMap.values()).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
};

/**
 * 获取最近使用的bash命令
 */
export const getRecentBashCommands = (
  workdir?: string,
  limit: number = 10,
): BashHistoryEntry[] => {
  try {
    const history = loadBashHistory();
    const filtered = workdir
      ? history.commands.filter((entry) => entry.workdir === workdir)
      : history.commands;

    // 去重后返回最近的命令
    const deduped = deduplicateCommands(filtered);
    return deduped.slice(-limit).reverse(); // 最新的在前面
  } catch (error) {
    logger.debug("Failed to get recent bash commands:", error);
    return [];
  }
};

/**
 * 清空bash历史
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
 * 获取bash命令统计信息
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
