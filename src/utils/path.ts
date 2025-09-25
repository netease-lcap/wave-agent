import { resolve } from "path";
import { homedir } from "os";

/**
 * 处理路径，支持 ~ 开头的路径扩展
 * @param filePath 文件路径
 * @param workdir 工作目录（可选）
 * @returns 解析后的绝对路径
 */
export function resolvePath(filePath: string, workdir?: string): string {
  // 如果路径以 ~ 开头，将其替换为用户主目录
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }

  // 如果路径以 ~ 开头但没有斜杠，表示就是主目录
  if (filePath === "~") {
    return homedir();
  }

  // 对于其他路径，使用原有逻辑
  if (workdir) {
    return resolve(workdir, filePath);
  }

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
