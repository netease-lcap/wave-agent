/**
 * 工具名 → 界面上显示给用户的名字。
 *
 * 只有一条映射：`REPL`（工具名，也是 `--tools` / `disallowedTools` / 权限规则里
 * 用的名字）在界面上显示为 `Code Mode`。这条口径在 spec `core/repl-tool.md`
 * 里定案——「工具名 = `REPL`，且只有这一个名字。用户可见的界面名是「Code Mode」」；
 * 设置页里那一行「核心工具收进 Code Mode」（`enableReplCoreTools`）指的就是
 * 这个工具，两处必须同一个词，否则用户要自己做一次术语换算。
 *
 * 只改**显示**：判据、`ToolBlock.name`、权限规则、`--tools` 一律继续用 `REPL`。
 */
import { REPL_TOOL_NAME } from "wave-agent-sdk/constants";

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  [REPL_TOOL_NAME]: "Code Mode",
};

/** 传 `undefined` / 空串时原样返回，调用方自己决定兜底文案（如 `Tool`）。 */
export function displayToolName(name: string | undefined): string | undefined {
  if (!name) return name;
  return TOOL_DISPLAY_NAMES[name] ?? name;
}
