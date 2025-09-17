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
