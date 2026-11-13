import * as path from "node:path";
import type { EsbuildApi } from "../utils/esbuild.js";

/**
 * 把 mod 源码转成沙箱可执行的 CJS。
 *
 * ## 为什么逐文件 `transform` 而不是一次 `build`
 *
 * 两者都不打包（mod 的相对 import 由 `modRuntime.ts` 自己的 `require` 解析，
 * 不走 node 解析、不读 `node_modules`），差别只在批量开销：60 个 5KB 文件
 * 实测 `build({bundle:false})` 11.5ms、逐文件 `transform` 约 48ms —— 都是
 * 一次性成本，而 `transform` 的报错天然带 `sourcefile`、也不必编造一个
 * 虚拟 outdir 再反查路径。选简单可控的那个。
 *
 * ## 产物形状
 *
 * - `format: "cjs"`：`import` 变成 `require("…")`，由沙箱的 require 接管。
 *   之所以不用 ESM：运行时无法重写已冻结的 import 说明符。
 * - `__wave.h` / `__wave.Fragment`：classic pragma 指向沙箱注入的全局对象，
 *   mod 自己不需要 import `h`。
 */
export interface ModSourceFile {
  /** 绝对路径，用于报错与产物索引。 */
  path: string;
  source: string;
}

/** 一个文件的编译结果：要么有 `code`，要么有 `error`。 */
export interface ModCompileOutcome {
  code?: string;
  error?: string;
}

/** 按扩展名选 esbuild loader；不认识的返回 `undefined`。 */
export function loaderFor(
  filePath: string,
): "tsx" | "ts" | "jsx" | "js" | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".tsx":
      return "tsx";
    case ".ts":
      return "ts";
    case ".jsx":
      return "jsx";
    case ".js":
      return "js";
    default:
      return undefined;
  }
}

/** esbuild 的错误对象里我们真正要展示的字段。 */
interface EsbuildMessage {
  text?: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
    lineText?: string;
  } | null;
}

/**
 * `file:line:column: message` —— 与 tsc 同形，日志与面板摘要都用它。
 *
 * esbuild 的 `text` 已经带了首行摘要，但把位置拼在前面才能让用户直接跳到
 * 出问题的行；没有位置信息时退回 `text` 本身。
 */
function formatMessage(message: EsbuildMessage, fallbackFile: string): string {
  const location = message.location;
  const text = message.text ?? "编译失败";
  if (!location?.line) return text;
  const file = location.file ?? fallbackFile;
  const column = location.column ?? 0;
  return `${file}:${location.line}:${column}: ${text}`;
}

/**
 * 编译一组 mod 文件。
 *
 * 单个文件失败不影响其它文件（spec「加载纪律」：该 mod 不生效，其余不受
 * 影响），所以返回的是「每个文件一个结果」而不是整体抛错。
 */
export async function compileMods(
  esbuild: EsbuildApi,
  files: ModSourceFile[],
): Promise<Map<string, ModCompileOutcome>> {
  const outcomes = new Map<string, ModCompileOutcome>();
  for (const file of files) {
    const loader = loaderFor(file.path);
    if (!loader) {
      outcomes.set(file.path, {
        error: `不支持的文件类型：${path.extname(file.path) || "(无扩展名)"}`,
      });
      continue;
    }
    try {
      const result = await esbuild.transform(file.source, {
        loader,
        format: "cjs",
        target: "node22",
        sourcefile: file.path,
        jsx: "transform",
        jsxFactory: "__wave.h",
        jsxFragment: "__wave.Fragment",
      });
      outcomes.set(file.path, { code: result.code });
    } catch (error) {
      const messages = (error as { errors?: EsbuildMessage[] }).errors;
      outcomes.set(file.path, {
        error: messages?.length
          ? messages.map((m) => formatMessage(m, file.path)).join("\n")
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
  return outcomes;
}
