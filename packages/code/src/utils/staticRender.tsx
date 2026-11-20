import React, { useLayoutEffect } from "react";
import { PassThrough } from "node:stream";
import { render, useApp } from "ink";

/**
 * 把一棵 Ink 组件树渲染成字符串（保留 ANSI）。`/export` 用它把消息流按**用户
 * 在终端里看到的样子**写成 `.txt`——与 Claude Code 同一条路：
 * `renderMessagesToPlainText` 就是把 CLI 自己的消息组件渲染一遍再剥 ANSI，而不是
 * 另写一套 Markdown 转换（同一个会话在两处的样子会立刻分叉）。
 *
 * 取巧点是「拿一个 `PassThrough` 当 stdout」：非 TTY 的 stdout 让 Ink 输出完整
 * 帧而不是差分，再用 `RenderOnceAndExit` 渲染一次就退出（Ink 不支持同一棵树里
 * 多个 `<Static>`，我们也不需要 `<Static>`）。Ink 在非 TTY 下会输出多帧，每帧
 * 被 DEC 同步更新标记包着（`ESC[?2026h … ESC[?2026l`），只取第一帧。
 */

/** 渲染一次就请求退出；`useLayoutEffect` 保证等到 React 提交完再退。 */
const RenderOnceAndExit: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { exit } = useApp();
  useLayoutEffect(() => {
    const timer = setTimeout(exit, 0);
    return () => clearTimeout(timer);
  }, [exit]);
  return <>{children}</>;
};

const SYNC_START = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

/** Ink 在非 TTY 下把每一帧包在 DEC 同步更新序列里；只要第一帧的内容。 */
function extractFirstFrame(output: string): string {
  const startIndex = output.indexOf(SYNC_START);
  if (startIndex === -1) return output;
  const contentStart = startIndex + SYNC_START.length;
  const endIndex = output.indexOf(SYNC_END, contentStart);
  if (endIndex === -1) return output;
  return output.slice(contentStart, endIndex);
}

/**
 * 剥掉 ANSI 转义序列（CSI 与 OSC）。不引 `strip-ansi`：`packages/code` 没声明
 * 它，而为这一个用途加一条依赖不值当。
 *
 * 正则从字符码拼出来，与 `packages/webview/src/utils/ideContext.ts` 同一个理由：
 * 字面量里写 `\x1b` 会被 `no-control-regex` 拦下。
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const TWO_BYTE_ESCAPE_RE = new RegExp(`${ESC}[@-Z\\\\-_]`, "g");

export function stripAnsi(text: string): string {
  return text
    .replace(OSC_RE, "") // OSC（含超链接、窗口标题）
    .replace(CSI_RE, "") // CSI（颜色、光标、擦除）
    .replace(TWO_BYTE_ESCAPE_RE, ""); // 其余两字节转义
}

/** 渲染成 ANSI 字符串。`columns` 不传时 Ink 按 80 列排（非 TTY 的兜底）。 */
export function renderToAnsiString(
  node: React.ReactElement,
  columns?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const stream = new PassThrough();
    if (columns !== undefined) {
      (stream as unknown as { columns: number }).columns = columns;
    }
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });

    void (async () => {
      try {
        const instance = render(<RenderOnceAndExit>{node}</RenderOnceAndExit>, {
          stdout: stream as unknown as NodeJS.WriteStream,
          patchConsole: false,
        });
        await instance.waitUntilExit();
        resolve(extractFirstFrame(output));
      } catch (error) {
        reject(error);
      }
    })();
  });
}

/** 渲染成纯文本（ANSI 全部剥掉）。 */
export async function renderToPlainText(
  node: React.ReactElement,
  columns?: number,
): Promise<string> {
  return stripAnsi(await renderToAnsiString(node, columns));
}
