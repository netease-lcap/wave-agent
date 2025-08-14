import { promises as fs } from "fs";
import { resolve } from "path";

export interface PathValidationResult {
  isValid: boolean;
  resolvedPath?: string;
  error?: string;
}

export class PathValidator {
  /**
   * 验证路径是否存在且可访问
   */
  static async validatePath(path: string): Promise<PathValidationResult> {
    if (!path || typeof path !== "string") {
      return {
        isValid: false,
        error: "Invalid path: path must be a non-empty string",
      };
    }

    try {
      const resolvedPath = resolve(path);
      const stats = await fs.stat(resolvedPath);

      if (!stats.isDirectory()) {
        return {
          isValid: false,
          error: "Path is not a directory",
        };
      }

      // 检查读取权限
      try {
        await fs.access(resolvedPath, fs.constants.R_OK);
      } catch {
        return {
          isValid: false,
          error: "Directory is not readable",
        };
      }

      return {
        isValid: true,
        resolvedPath,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          isValid: false,
          error: "Directory does not exist",
        };
      }

      if ((error as NodeJS.ErrnoException).code === "EACCES") {
        return {
          isValid: false,
          error: "Permission denied",
        };
      }

      return {
        isValid: false,
        error: `Failed to access directory: ${errorMessage}`,
      };
    }
  }

  /**
   * 尝试多个候选路径，返回第一个有效的
   */
  static async findValidPath(
    candidates: string[],
  ): Promise<PathValidationResult> {
    for (const candidate of candidates) {
      const result = await this.validatePath(candidate);
      if (result.isValid) {
        return result;
      }
    }

    return {
      isValid: false,
      error: `None of the candidate paths are valid: ${candidates.join(", ")}`,
    };
  }

  /**
   * 获取当前工作目录作为备选方案
   */
  static getCurrentWorkdir(): string {
    return process.cwd();
  }

  /**
   * 规范化路径（解析相对路径、软链接等）
   */
  static async normalizePath(path: string): Promise<string> {
    try {
      const resolvedPath = resolve(path);
      return await fs.realpath(resolvedPath);
    } catch {
      // 如果无法解析（如路径不存在），返回resolve后的路径
      return resolve(path);
    }
  }
}
