/**
 * `$.fs`（spec「读写文件」）。
 *
 * 相对路径按**会话当前**的工作目录解析，与 `$.process.spawn` 的 `cwd` 缺省值
 * 同一条口径（容器 token `CurrentWorkdir`，会随 `cd` 动）：mod 起外部进程时
 * 它落在哪个目录，读相对路径就该是哪个目录 —— 两边不一致时，「写一个文件让
 * 脚本去读」这种最常用的写法会在会话 `cd` 过之后悄悄错开。不是会话起点，也
 * 不是工作区根。
 *
 * **不设路径白名单**：同一插件的 hooks 本来就在跑 shell，mod 也能 `spawn`
 * 任意命令读同一个文件。白名单只是让「读」比「读」更难，不提高任何安全性
 * （与 spec「外部进程」的信任论证是同一条）。
 */

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "../utils/atomicWrite.js";
import { MOD_LIMITS, type ModFsEntry, type ModFsStat } from "../types/mods.js";

/** 一次 `read` 的形态：文本，或二进制的 base64。 */
export interface ModFsReadOptions {
  as?: "text" | "bytes";
}

export class ModFs {
  private readonly cwd: () => string;

  constructor(cwd: () => string) {
    this.cwd = cwd;
  }

  /** `read(path)` 给文本，`read(path, { as: "bytes" })` 给 `{ base64 }`。 */
  async read(
    filePath: unknown,
    options?: ModFsReadOptions,
  ): Promise<string | { base64: string }> {
    const target = this.resolve(filePath, "$.fs.read");
    const as = options?.as ?? "text";
    if (as !== "text" && as !== "bytes") {
      throw new Error(`$.fs.read 的 as 只能是 "text" 或 "bytes"`);
    }
    // 先看大小再读：一个几 GB 的日志读进来就是一次 OOM，而不是一次报错。
    const stat = await fsp.stat(target);
    if (stat.size > MOD_LIMITS.fsFileBytes) {
      throw new Error(
        `$.fs.read 的文件超过 ${MOD_LIMITS.fsFileBytes} 字节：${target}`,
      );
    }
    const data = await fsp.readFile(target);
    return as === "bytes"
      ? { base64: data.toString("base64") }
      : data.toString("utf8");
  }

  /** 覆盖写入，走原子写：读者永远看不到半截文件。 */
  async write(filePath: unknown, text: unknown): Promise<void> {
    const target = this.resolve(filePath, "$.fs.write");
    if (typeof text !== "string") {
      throw new Error("$.fs.write 的第二个参数必须是字符串");
    }
    const bytes = Buffer.byteLength(text);
    if (bytes > MOD_LIMITS.fsFileBytes) {
      throw new Error(
        `$.fs.write 的内容超过 ${MOD_LIMITS.fsFileBytes} 字节：${bytes}`,
      );
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await atomicWriteFile(target, text);
  }

  /** 一个目录的一层条目，不递归。 */
  async list(dirPath: unknown): Promise<ModFsEntry[]> {
    const target = this.resolve(dirPath, "$.fs.list");
    const names = await fsp.readdir(target);
    const entries = await Promise.all(
      names.map(async (name): Promise<ModFsEntry> => {
        const at = path.join(target, name);
        // `lstat` 不跟随符号链接：`isLink` 要说的是这一条本身是不是链接。
        const stat = await fsp.lstat(at);
        return {
          name,
          kind: stat.isDirectory() ? "dir" : "file",
          size: stat.size,
          isLink: stat.isSymbolicLink(),
        };
      }),
    );
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async stat(filePath: unknown): Promise<ModFsStat> {
    const target = this.resolve(filePath, "$.fs.stat");
    const stat = await fsp.lstat(target);
    return {
      kind: stat.isDirectory() ? "dir" : "file",
      size: stat.size,
      isLink: stat.isSymbolicLink(),
    };
  }

  /** 不存在就是 `false`，不抛错：调用方通常只想知道「有没有」。 */
  async exists(filePath: unknown): Promise<boolean> {
    const target = this.resolve(filePath, "$.fs.exists");
    try {
      await fsp.lstat(target);
      return true;
    } catch {
      return false;
    }
  }

  private resolve(filePath: unknown, who: string): string {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new Error(`${who} 需要一个非空路径字符串`);
    }
    return path.resolve(this.cwd(), filePath);
  }
}
