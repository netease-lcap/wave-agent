import { resolve } from "path";
import { homedir } from "os";
import { promises as fs } from "fs";
import { relative } from "path";

/**
 * 处理路径，支持 ~ 开头的路径扩展
 * @param filePath 文件路径
 * @returns 解析后的绝对路径
 */
export function resolvePath(filePath: string): string {
  // 如果路径以 ~ 开头，将其替换为用户主目录
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }

  // 如果路径以 ~ 开头但没有斜杠，表示就是主目录
  if (filePath === "~") {
    return homedir();
  }

  // 对于其他路径，使用当前工作目录解析
  return resolve(filePath);
}

/**
 * 二进制文件扩展名列表
 */
export const binaryExtensions = [
  // 图片文件
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "svg",
  "sketch",
  // 音频文件
  "mp3",
  "wav",
  "ogg",
  "aac",
  // 视频文件
  "mp4",
  "webm",
  "avi",
  "mov",
  // 文档文件
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // 压缩文件
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  // 字体文件
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  // 其他二进制文件
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
] as const;
/**
 * 检查文件是否为二进制文件
 * @param filename 文件名
 * @returns 是否为二进制文件
 */
export const isBinary = (filename: string): boolean => {
  const parts = filename.split(".");
  const ext = parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
  return binaryExtensions.includes(ext as (typeof binaryExtensions)[number]);
};

/**
 * 获取相对路径用于显示，如果相对路径更短且不在父目录则使用相对路径
 * @param filePath 绝对路径
 * @returns 用于显示的路径（相对路径或绝对路径）
 */
export function getDisplayPath(filePath: string): string {
  if (!filePath) {
    return filePath;
  }

  try {
    const cwd = process.cwd();
    const relativePath = relative(cwd, filePath);

    // 如果相对路径为空（即路径相同），返回 "."
    if (relativePath === "") {
      return ".";
    }

    // 如果相对路径比绝对路径短且不以 .. 开头（不在父目录），则使用相对路径
    if (
      relativePath.length < filePath.length &&
      !relativePath.startsWith("..")
    ) {
      return relativePath;
    }
  } catch {
    // 如果计算相对路径失败，保持原路径
  }
  return filePath;
}

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
