import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModSessionVersion } from "../types/mods.js";

let cached: ModSessionVersion | undefined;

/**
 * 引擎版本（`$.session.version()` 的数据源，spec「会话事实」）。
 *
 * 从本模块所在位置往上找最近的 `package.json`：源码跑（`tsx`）与 `dist/` 布局
 * 都能找到 SDK 自己那一份，被 CLI 内联打包时找到的是宿主包的那一份 —— 两种
 * 都对，因为「引擎版本」问的就是「跑起来的这个包是哪个版本」。
 *
 * 读一次就缓存。**模块 import 时什么都不做**（SDK 的零副作用约定），第一次
 * 调用时才读一次盘；读不到给空串，不编一个版本号出来。
 */
export function engineVersion(): ModSessionVersion {
  cached ??= readVersion();
  return cached;
}

function readVersion(): ModSessionVersion {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 6; depth += 1) {
      const file = path.join(dir, "package.json");
      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
          version?: unknown;
        };
        return typeof json.version === "string"
          ? { version: json.version }
          : { version: "" };
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // 读不动就当没有：`version` 空串，`base` / `builtAt` 不编。
  }
  return { version: "" };
}
