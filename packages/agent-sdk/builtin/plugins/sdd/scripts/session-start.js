#!/usr/bin/env node
// SessionStart hook for the sdd built-in plugin.
// Emits the spec-first workflow guidance as additionalContext (JSON form),
// resolving the absolute path to the plugin's spec-count validator so the
// agent can run it from its bash tool (which does not carry WAVE_PLUGIN_ROOT).
import path from "node:path";

const root =
  process.env.WAVE_PLUGIN_ROOT ||
  path.dirname(new URL("..", import.meta.url).pathname);
const specCount = `node ${JSON.stringify(path.join(root, "scripts", "spec-count.js"))}`;

const guidance = [
  "Spec-First Workflow（规格优先工作流）：",
  "- 需求增加或变更时，优先更新 spec：先更新对应规格说明（新增用户故事、验收场景），待用户确认 spec 后再实现代码。spec 是功能设计的权威来源，不是 changelog。",
  "- 边界模糊时也先写 spec 草稿请用户确认，不要直接改代码。",
  "- 规格编写技能（specify）由 AI 自动触发：对话中涉及新需求或需求变更时主动创建或更新规格文件，不需要用户手动调用（不出现在斜杠命令列表中）。",
  `- 新增或修改 spec 后运行校验：${specCount}（自动检测 docs/specs/，否则 specs/，否则退出）。`,
].join("\n");

// JSON form → parsed as hookSpecificOutput.additionalContext by the hook manager.
console.log(
  JSON.stringify({ hookSpecificOutput: { additionalContext: guidance } }),
);
