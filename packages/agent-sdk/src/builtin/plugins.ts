export const sddPlugin: Record<string, string> = {
  "plugins/sdd/.wave-plugin/plugin.json": `{
  "name": "sdd",
  "description": "Spec-first workflow: specify skill, SessionStart guidance, and spec-count validation.",
  "version": "1.0.0",
  "author": {
    "name": "Wave Team"
  }
}
`,
  "plugins/sdd/hooks/hooks.json": `{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \\"\${WAVE_PLUGIN_ROOT}/scripts/session-start.js\\""
          }
        ]
      }
    ]
  }
}
`,
  "plugins/sdd/scripts/session-start.js": `#!/usr/bin/env node
// SessionStart hook for the sdd built-in plugin.
// Emits the spec-first workflow guidance as additionalContext (JSON form),
// resolving the absolute path to the plugin's spec-count validator so the
// agent can run it from its bash tool (which does not carry WAVE_PLUGIN_ROOT).
import path from "node:path";

const root =
  process.env.WAVE_PLUGIN_ROOT ||
  path.dirname(new URL("..", import.meta.url).pathname);
const specCount = \`node \${JSON.stringify(path.join(root, "scripts", "spec-count.js"))}\`;

const guidance = [
  "Spec-First Workflow（规格优先工作流）：",
  "- 需求增加或变更时，优先更新 spec：先更新对应规格说明（新增用户故事、验收场景），待用户确认 spec 后再实现代码。spec 是功能设计的权威来源，不是 changelog。",
  "- 边界模糊时也先写 spec 草稿请用户确认，不要直接改代码。",
  "- 规格编写技能（specify）由 AI 自动触发：对话中涉及新需求或需求变更时主动创建或更新规格文件，不需要用户手动调用（不出现在斜杠命令列表中）。",
  \`- 新增或修改 spec 后运行校验：\${specCount}（自动检测 docs/specs/，否则 specs/，否则退出）。\`,
  "- 规格确认与阶段衔接一次完成：通过 AskUserQuestion 单选让用户点击决策（选项只传「直接实现 / 制定技术方案」，并在问题文案中说明如需调整规格可选「其他」输入修改意见；「其他」由 AskUserQuestion 自动附加，勿手动添加；选「其他」=规格需调整，按反馈修改后再次询问）。",
  "- 可选技术方案阶段：制定技术方案并批准后再编码；也可跳过——最短流程=规格+执行，最长=规格+技术方案+执行。",
  "- 进入执行阶段时用一次单选选执行方式（普通执行 / 子代理驱动 / 工作流编排），选定后按任务清单一路做到底，中途不询问是否继续。",
].join("\\n");

// JSON form → parsed as hookSpecificOutput.additionalContext by the hook manager.
console.log(
  JSON.stringify({ hookSpecificOutput: { additionalContext: guidance } }),
);
`,
  "plugins/sdd/scripts/spec-count.js": `#!/usr/bin/env node
// Generic, self-contained spec validator. Counts user stories and acceptance
// scenarios under the project's specs directory and warns on missing sections.
// Detects the specs dir: prefers docs/specs/, else specs/, else exits gracefully.
// No dependency on any project's VitePress/docs-site modules.
import fs from "node:fs";
import path from "node:path";

function detectSpecsDir() {
  for (const dir of ["docs/specs", "specs"]) {
    const resolved = path.resolve(process.cwd(), dir);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(fullPath);
  }
  return out;
}

function countUserStories(content) {
  const m = content.match(/^### 用户故事[：:]/gm);
  return m ? m.length : 0;
}

function countAcceptanceScenarios(content) {
  const m = content.match(/^\\d+\\.\\s+\\*\\*假设\\*\\*/gm);
  return m ? m.length : 0;
}

const specsDir = detectSpecsDir();
if (!specsDir) {
  console.log("未找到规格目录（docs/specs/ 或 specs/），跳过校验。");
  process.exit(0);
}

const files = walk(specsDir).sort();
const totals = { specs: 0, us: 0, ac: 0 };
const warnings = [];

// index.md is conventionally a directory listing page, not a spec — skip it.
const specFiles = files.filter(
  (fp) => path.basename(fp).toLowerCase() !== "index.md",
);

for (const fp of specFiles) {
  const content = fs.readFileSync(fp, "utf-8");
  const usCount = countUserStories(content);
  const acCount = countAcceptanceScenarios(content);
  const rel = path.relative(process.cwd(), fp);
  totals.specs++;
  totals.us += usCount;
  totals.ac += acCount;
  if (!content.match(/^## 用户场景与测试/m))
    warnings.push(\`\${rel}: 缺少 "## 用户场景与测试" 章节\`);
  if (usCount === 0)
    warnings.push(\`\${rel}: 未找到用户故事（期望 \\\`### 用户故事：\\\`）\`);
  if (acCount === 0)
    warnings.push(
      \`\${rel}: 未找到验收场景（期望 \\\`N. **假设** … **当** … **则** …\\\`）\`,
    );
  console.log(\`\${rel}  用户故事: \${usCount}  验收场景: \${acCount}\`);
}

console.log("---");
console.log(
  \`规格: \${totals.specs}  用户故事: \${totals.us}  验收场景: \${totals.ac}\`,
);
if (warnings.length) {
  for (const w of warnings) console.warn(\`⚠ \${w}\`);
  console.warn(\`⚠ \${warnings.length} 条模板警告——见上方。\`);
}
`,
  "plugins/sdd/skills/specify/SKILL.md": `---
name: specify
description: 根据自然语言描述创建或更新功能规格说明，并通过单选衔接可选技术方案与执行阶段。
user-invocable: false
---

## 用户输入

\`\`\`text
$ARGUMENTS
\`\`\`

## 流程

本技能由 AI 在会话中自动触发（不占用手动斜杠命令）。触发时机：用户提出新的需求、修改需求或涉及功能边界时，若对应规格尚未创建或已过期，则主动创建或更新规格说明。$ARGUMENTS 通常为空——需求描述直接来自对话上下文，不要让用户重复。

根据对话中的功能描述，执行以下步骤：

1. **确定规格文件路径**：
   - **确定规格根目录**：优先复用项目中已有的规格目录——若 \`docs/specs/\` 存在则用之，否则若 \`specs/\` 存在则用之，否则默认 \`specs/\`（并在完成报告中说明所选目录，便于用户纠正）。
   - **选择分组**：若规格目录下已有分组子目录，沿用其既有分组约定；否则默认扁平结构（直接放在规格根目录下）。
   - 根据功能描述生成 2-4 个词的 slug（小写、连字符、保留缩写词），与组内已有文件名不冲突
   - 规格文件路径：\`<规格根目录>/<分组>/<slug>.md\`（无分组时为 \`<规格根目录>/<slug>.md\`）

2. **加载模板** \`\${WAVE_SKILL_DIR}/templates/spec-template.md\`，了解必需章节。

3. **编写规格说明**：
   - 解析用户描述，提取关键概念：角色、操作、数据、约束
   - 对于不明确的部分，根据上下文和行业标准做出合理推断
   - 仅在关键决策处标记 \`[待澄清：具体问题]\`（最多 3 处）
   - 填写 frontmatter（\`name\` 为功能中文名、\`description\` 为一句话简述、\`order\` 为控制组内排序的数字）
   - 填写「用户场景与测试」章节，包含按优先级排序的用户故事（P1、P2、P3...），每个故事以「作为…，我希望…，以便…」描述，附 \`**为什么是这个优先级**\` 与 \`**独立测试**\`（不适用的可省略）
   - 为每个用户故事编写可测试的验收场景（**假设** … **当** … **则** …）
   - 写入规格文件，替换所有占位符

4. **如果存在 \`[待澄清]\` 标记**（最多 3 处）：
   - 将每个标记作为问题展示，附带建议答案
   - 等待用户回复后更新规格文件

5. **校验并确认规格**：
   - 运行会话引导中给出的 spec-count 校验命令（自动检测 docs/specs/，否则 specs/，否则跳过）
   - 输出规格文件路径，并通过 AskUserQuestion 单选请求决策（选项只传：直接实现 / 制定技术方案；AskUserQuestion 会自动附加「其他」选项，勿手动添加「其他」；在问题文案中说明如需调整规格可选「其他」并输入修改意见）
   - 用户选「其他」并输入意见 → 视为规格需要调整：按用户反馈更新规格后重新校验，并再次单选
   - 选「直接实现」→ 进入执行阶段（第 6 步）
   - 选「制定技术方案」→ 调用 EnterPlanMode 进入技术方案模式，制定技术方案（技术选型、架构设计、实现步骤）并写入计划文件；用 ExitPlanMode 请求批准——被拒绝则按反馈更新方案后重新请求，批准后进入执行阶段（第 6 步）

6. **执行阶段**：

   先做一次 AskUserQuestion 单选（两条入口共用、不沿用此前选择，「其他」由工具自动提供），问题文案里给一句推荐及理由（看规格的用户故事条数与各故事「独立测试」的独立程度）：
   - 普通执行 —— 本会话逐项写完，最后整体评审。
   - 子代理驱动 —— 每任务一个 general-purpose 子代理实现 + 一个评审；不通过就把阻断项回灌重做一个来回，仍不通过就问用户。
   - 工作流编排 —— 用 Workflow 按任务清单跑（脚本自己写），后台执行，可用 /workflows 看进度。

   任务清单直接取自已确认规格里的验收场景（一条验收场景 = 一个任务，1-8 个），它是三档唯一的任务源；选定后一路做到底：不中途问「要不要继续」、不重复问执行方式。

   - 普通执行：逐项实现，做完一次整体评审。
   - 子代理驱动：任务之间互不依赖就并发（每个带 \`isolation: "worktree"\`，改动留在各自工作树，共享文件也不冲突；但隔离工作树看不到彼此的产出，有依赖的任务必须串行）；收口时按序合并各工作树、解决冲突、合并后重跑验证，再逐任务评审各支自己的 diff。
   - 工作流编排：写阶段串行（工作流的 agent 拿不到工作树隔离），只读阶段可并行；起起来后等完成通知，自己不再动手实现同一批任务。

   整体评审三档都做一次。会话被压缩或重启后，按规格里的验收场景与 git log 判断做到哪，别重复已完成的任务。

## 指南

- 关注用户**需要什麼**和**为什么**，而非如何实现
- 不包含实现细节（不涉及技术栈、API、代码结构）
- 每个验收场景必须可测试、无歧义
- 删除不适用的可选章节（不要留 "N/A"）
`,
  "plugins/sdd/skills/specify/templates/spec-template.md": `---
name: "[功能名称]"
description: "[一句话简短描述]"
order: [数字，控制组内排序]
---

# 功能规格说明：[功能名称]

**创建日期**：[日期]

## 用户场景与测试 *（必填）*

### 用户故事：[简要标题]（优先级：P1）

作为[角色]，我希望[操作]，以便[价值/目的]。

**为什么是这个优先级**：[解释其价值以及为何具有此优先级]

**独立测试**：[描述如何独立测试——例如，"可以通过 [具体操作] 进行完整测试，并交付 [具体价值]"]

**验收场景**：

1. **假设** [初始状态]，**当** [操作]，**则** [预期结果]
2. **假设** [初始状态]，**当** [操作]，**则** [预期结果]

---

### 用户故事：[简要标题]（优先级：P2）

作为[角色]，我希望[操作]，以便[价值/目的]。

**为什么是这个优先级**：[解释其价值以及为何具有此优先级]

**独立测试**：[描述如何独立测试]

**验收场景**：

1. **假设** [初始状态]，**当** [操作]，**则** [预期结果]

---

[根据需要添加更多用户故事，每个都分配优先级]

### 边界情况

- **[问题？]** [答案/处理方式]
- **[问题？]** [答案/处理方式]
`,
};

/**
 * 内置 diff 插件（spec `commands/diff-command.md`）。
 *
 * 只在终端里注册 `/diff`（`session.start` 里看 `$.session.surfaces()` 有没有
 * `terminal`）：桌面端与 IDE 已经有原生差异面板，再挂一个 mod 面板就是同一份
 * 东西画两遍。默认开（见 `pluginPolicies.ts`）—— 它在别的端与别的轮次里一个
 * 钩子都不会跑，代价只是多一条命令。
 */
export const diffPlugin: Record<string, string> = {
  "plugins/diff/.wave-plugin/plugin.json": `{
  "name": "diff",
  "description": "Show uncommitted changes and per-turn edits in a terminal pane.",
  "version": "1.0.0",
  "author": {
    "name": "Wave Team"
  }
}
`,
  "plugins/diff/mods/diff.tsx": `const PANE_ID = "diff";
const TITLE = "Diff";
const LIST_WINDOW = 8;
const MAX_LINES = 400;
const MAX_CHARS = 60000;
const MAX_CELLS = 40000;
const MAX_UNTRACKED = 20;
const MAX_SOURCES = 63;
const DETAIL_MAX_ROWS = 20;
// 键位提示（插件自己画的普通 \`Text\`，spec「键位提示」）。位置按视图分：列表一屏
// 画得下、永不滚动，放面板底部（与 Claude Code 一致）；详情里整棵树归 surface 滚，
// 放底部要滚到最后一屏才看得见，所以放在表头下一行 —— 进详情的第一屏就有。
const HINT_LIST = "↑/↓ to select · Enter to view · Esc to close";
const HINT_DETAIL = "↑/↓ to scroll · Esc to back";

let sourceKey = "current";
let view = "list";
let selectedPath = "";
let listTop = 0;
// 详情视图自己的滚动偏移。它不交给 surface 滚：详情整棵树必须**装得下**，
// 底部的键位提示才钉得住（spec「ui.scroll：mod 自己滚」）。
let detailTop = 0;
let cache = { current: { files: [], note: "" }, turns: [] };
let declaredRows = 0;
// 面板正文一次能画多少行（e.props.scroll.bodyRows，surface 量到的）：详情靠它
// 算窗口。0 = 还没量到，按默认封顶折算。
let bodyRows = 0;

function splitLines(text) {
  if (typeof text !== "string" || text === "") return [];
  const parts = text.split("\\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function countKinds(lines) {
  let added = 0;
  let removed = 0;
  for (let index = 0; index < lines.length; index = index + 1) {
    const first = lines[index].charAt(0);
    if (first === "+") added = added + 1;
    else if (first === "-") removed = removed + 1;
  }
  return { added: added, removed: removed };
}

// 行数与字符两条线一起截，谁先到算谁（\`Code\` 走树内文本预算，一条巨大的 diff
// 必须在这里就夹住，而不是等校验器整棵拒掉）。
function makeFile(path, lines, note) {
  const kept = [];
  let chars = 0;
  let truncated = false;
  for (let index = 0; index < lines.length; index = index + 1) {
    const line = lines[index];
    if (kept.length >= MAX_LINES || chars + line.length > MAX_CHARS) {
      truncated = true;
      break;
    }
    kept.push(line);
    chars = chars + line.length + 1;
  }
  const counts = countKinds(kept);
  return {
    path: path,
    additions: counts.added,
    deletions: counts.removed,
    text: kept.join("\\n"),
    truncated: truncated,
    note: note,
  };
}

// 行级 LCS：先剥掉公共前后缀（改动通常只占一小段），中段再做 DP。中段大到
// 装不下表时退化成「整段删 + 整段增」，结果仍是合法 diff，只是没那么精细。
function diffBody(oldText, newText) {
  const before = splitLines(oldText);
  const after = splitLines(newText);
  const out = [];
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    out.push(" " + before[head]);
    head = head + 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  const tail = [];
  while (
    endBefore > head &&
    endAfter > head &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore = endBefore - 1;
    endAfter = endAfter - 1;
    tail.unshift(" " + before[endBefore]);
  }
  const midBefore = before.slice(head, endBefore);
  const midAfter = after.slice(head, endAfter);
  if (midBefore.length * midAfter.length > MAX_CELLS) {
    for (let i = 0; i < midBefore.length; i = i + 1) {
      out.push("-" + midBefore[i]);
    }
    for (let j = 0; j < midAfter.length; j = j + 1) {
      out.push("+" + midAfter[j]);
    }
  } else if (midBefore.length > 0 || midAfter.length > 0) {
    const table = [];
    for (let i = 0; i <= midBefore.length; i = i + 1) {
      const row = [];
      for (let j = 0; j <= midAfter.length; j = j + 1) row.push(0);
      table.push(row);
    }
    for (let i = midBefore.length - 1; i >= 0; i = i - 1) {
      for (let j = midAfter.length - 1; j >= 0; j = j - 1) {
        table[i][j] =
          midBefore[i] === midAfter[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midBefore.length && j < midAfter.length) {
      if (midBefore[i] === midAfter[j]) {
        out.push(" " + midBefore[i]);
        i = i + 1;
        j = j + 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        out.push("-" + midBefore[i]);
        i = i + 1;
      } else {
        out.push("+" + midAfter[j]);
        j = j + 1;
      }
    }
    while (i < midBefore.length) {
      out.push("-" + midBefore[i]);
      i = i + 1;
    }
    while (j < midAfter.length) {
      out.push("+" + midAfter[j]);
      j = j + 1;
    }
  }
  for (let k = 0; k < tail.length; k = k + 1) out.push(tail[k]);
  return out;
}

// 读 git 的 unified diff：一个文件一块，块内只留 \`@@\` 与正文行。行首那个空格
// 是 diff 格式的一部分（上下文行的第一个字符就是空格），不能吃掉。
function parsePatch(text) {
  const files = [];
  let file = null;
  let inHunks = false;
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index = index + 1) {
    const line = lines[index];
    if (line.indexOf("diff --git ") === 0) {
      file = { path: "", lines: [], binary: false };
      files.push(file);
      inHunks = false;
      continue;
    }
    if (file === null) continue;
    if (!inHunks) {
      if (line.indexOf("+++ ") === 0) {
        const name = line.slice(4).trim();
        if (name !== "/dev/null") {
          file.path = name.indexOf("b/") === 0 ? name.slice(2) : name;
        }
        continue;
      }
      if (line.indexOf("--- ") === 0) {
        const name = line.slice(4).trim();
        if (name !== "/dev/null" && file.path === "") {
          file.path = name.indexOf("a/") === 0 ? name.slice(2) : name;
        }
        continue;
      }
      if (line.indexOf("Binary files ") === 0) {
        file.binary = true;
        continue;
      }
      if (line.indexOf("@@") === 0) inHunks = true;
      else continue;
    }
    if (line.indexOf("@@") === 0) {
      file.lines.push(line);
      continue;
    }
    if (line === "") continue;
    const first = line.charAt(0);
    // \`\\ No newline at end of file\` 这类注解不进视图。
    if (first === "\\\\") continue;
    if (first === " " || first === "+" || first === "-") {
      file.lines.push(line);
      continue;
    }
    file.lines.push(" " + line);
  }
  const out = [];
  for (let index = 0; index < files.length; index = index + 1) {
    const entry = files[index];
    if (entry.path === "") continue;
    if (entry.binary) {
      out.push({
        path: entry.path,
        additions: 0,
        deletions: 0,
        text: "",
        truncated: false,
        note: "binary",
      });
      continue;
    }
    out.push(makeFile(entry.path, entry.lines, ""));
  }
  return out;
}

// 工具入参里的路径通常是绝对路径，展示与合并都按会话工作根相对化。
function displayPath(path, root) {
  if (typeof path !== "string" || path === "") return "";
  if (typeof root !== "string" || root === "") return path;
  if (path.indexOf(root + "/") === 0) return path.slice(root.length + 1);
  return path;
}

async function readUntracked($, root, path) {
  let text = null;
  try {
    text = await $.fs.read(root + "/" + path);
  } catch (error) {
    return null;
  }
  if (typeof text !== "string") return null;
  if (text.indexOf("\\u0000") >= 0) {
    return {
      path: path,
      additions: 0,
      deletions: 0,
      text: "",
      truncated: false,
      note: "binary",
    };
  }
  const lines = splitLines(text);
  const added = [];
  for (let index = 0; index < lines.length; index = index + 1) {
    added.push("+" + lines[index]);
  }
  return makeFile(path, added, "untracked");
}

// 「Current」：工作区相对 HEAD 的改动，外加还没 \`git add\` 的新文件。
async function loadCurrent($, root) {
  const repo = await $.session.repo();
  if (repo === null) {
    return { files: [], note: "not a git repository; nothing to compare" };
  }
  const head = await $.process.run(["git", "rev-parse", "--verify", "HEAD"], {
    cwd: root,
  });
  const args = ["git", "diff"];
  if (head.exitCode === 0) args.push("HEAD");
  args.push("--no-color", "--no-ext-diff", "--no-renames", "--unified=3");
  const patch = await $.process.run(args, { cwd: root });
  if (patch.exitCode !== 0) {
    const detail = (patch.stderr || "").trim();
    return { files: [], note: detail === "" ? "git diff failed" : detail };
  }
  const files = parsePatch(patch.stdout);
  const status = await $.process.run(["git", "status", "--porcelain"], {
    cwd: root,
  });
  const statusLines = splitLines(status.stdout);
  let untracked = 0;
  for (let index = 0; index < statusLines.length; index = index + 1) {
    const line = statusLines[index];
    if (line.slice(0, 2) !== "??") continue;
    if (untracked >= MAX_UNTRACKED) break;
    const name = line.slice(3).trim();
    if (name === "") continue;
    untracked = untracked + 1;
    const file = await readUntracked($, root, name);
    if (file !== null) files.push(file);
  }
  return { files: files, note: "" };
}

// 一轮里的改动：\`Edit\` 用旧文/新文重算行 diff，\`Write\` 全是新增，\`MultiEdit\` 逐条拼。
function editOf(block) {
  if (!block || block.type !== "tool_use") return null;
  const input =
    block.input !== null && typeof block.input === "object" ? block.input : {};
  const path = typeof input.file_path === "string" ? input.file_path : "";
  if (path === "") return null;
  if (
    block.name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return { path: path, body: diffBody(input.old_string, input.new_string) };
  }
  if (block.name === "Write" && typeof input.content === "string") {
    const lines = splitLines(input.content);
    const body = [];
    for (let index = 0; index < lines.length; index = index + 1) {
      body.push("+" + lines[index]);
    }
    return { path: path, body: body };
  }
  if (block.name === "MultiEdit" && Array.isArray(input.edits)) {
    let body = [];
    for (let index = 0; index < input.edits.length; index = index + 1) {
      const edit = input.edits[index];
      if (
        edit === null ||
        typeof edit !== "object" ||
        typeof edit.old_string !== "string" ||
        typeof edit.new_string !== "string"
      ) {
        continue;
      }
      body = body.concat(diffBody(edit.old_string, edit.new_string));
    }
    return body.length === 0 ? null : { path: path, body: body };
  }
  return null;
}

// 按用户轮切分：每次用户说话起一轮，最新的一轮排在最前。
async function loadTurns($, root) {
  const messages = await $.session.messages();
  const turns = [];
  let turn = null;
  let index = 0;
  for (let m = 0; m < messages.length; m = m + 1) {
    const message = messages[m];
    const blocks = Array.isArray(message.content) ? message.content : [];
    if (message.role === "user") {
      let text = "";
      for (let b = 0; b < blocks.length; b = b + 1) {
        if (blocks[b].type !== "text") continue;
        text = text === "" ? blocks[b].text : text + " " + blocks[b].text;
      }
      text = text.replace(/\\s+/g, " ").trim();
      if (text.length > 40) text = text.slice(0, 39) + "…";
      index = index + 1;
      turn = { index: index, preview: text, files: [], byPath: {} };
      turns.push(turn);
      continue;
    }
    if (turn === null || message.role !== "assistant") continue;
    for (let b = 0; b < blocks.length; b = b + 1) {
      const edit = editOf(blocks[b]);
      if (edit === null) continue;
      const path = displayPath(edit.path, root);
      let entry = turn.byPath[path];
      if (entry === undefined) {
        entry = makeFile(path, [], "");
        turn.byPath[path] = entry;
        turn.files.push(entry);
      }
      const counts = countKinds(edit.body);
      entry.additions = entry.additions + counts.added;
      entry.deletions = entry.deletions + counts.removed;
      // 同一轮里改同一个文件多次：正文拼起来（截断只在这一步判一次）。
      const merged =
        entry.text === "" ? edit.body : splitLines(entry.text).concat(edit.body);
      const next = makeFile(path, merged, "");
      entry.text = next.text;
      entry.truncated = entry.truncated || next.truncated;
    }
  }
  return turns.reverse();
}

function currentSource() {
  if (sourceKey === "current") return cache.current;
  for (let index = 0; index < cache.turns.length; index = index + 1) {
    if (String(cache.turns[index].index) === sourceKey) return cache.turns[index];
  }
  return { files: [], note: "" };
}

function selectedFile() {
  const files = currentSource().files;
  for (let index = 0; index < files.length; index = index + 1) {
    if (files[index].path === selectedPath) return files[index];
  }
  return null;
}

function clampTop(top, total) {
  const maxTop = total > LIST_WINDOW ? total - LIST_WINDOW : 0;
  if (top < 0) return 0;
  return top > maxTop ? maxTop : top;
}

// 详情视图的正文窗口：面板正文行数扣掉表头（返回按钮 + 路径，1 行）、底部键位
// 提示（1 行），被截断时再扣一行说明。剩下的才是能放 diff 的行数。
function detailWindow(file) {
  const rows = bodyRows > 0 ? bodyRows : DETAIL_MAX_ROWS + 2;
  const reserved = 2 + (file !== null && file.truncated ? 1 : 0);
  const window = rows - reserved;
  return window > 0 ? window : 1;
}

// 详情里要画的那一段（detailTop 已经夹在 [0, maxTop] 之间）。
function detailSlice(lines, window) {
  const maxTop = lines.length > window ? lines.length - window : 0;
  const top = detailTop > maxTop ? maxTop : detailTop;
  return { top: top, lines: lines.slice(top, top + window) };
}

// 面板要占几行：列表按文件名数，详情按差异行数（多出来的由面板自己滚）。
// 小于默认封顶（12 行）时申报不影响版面（\`ModSurface\` 取两者里大的），所以这里
// 只求准 —— 值准了，列表与详情之间的高度差才只在真需要时才重开面板。
//
// 详情这里按**内容**算（上限 \`DETAIL_MAX_ROWS\`），不按「一屏现在能放几行」：
// 一屏的行数来自 surface 报的 \`bodyRows\`，而 \`bodyRows\` 又是按申报的高度算的 ——
// 拿它算申报就成了自己咬自己，终端加高之后窗口永远停在老大小。
function desiredRows() {
  if (view === "detail") {
    const file = selectedFile();
    if (file === null) return 4;
    const lines = file.text === "" ? 1 : splitLines(file.text).length;
    const shown = lines > DETAIL_MAX_ROWS ? DETAIL_MAX_ROWS : lines;
    return 2 + shown + (file.truncated ? 1 : 0);
  }
  const source = currentSource();
  const files = source.files.length;
  const shown = files > LIST_WINDOW ? LIST_WINDOW : files;
  const turn = sourceKey === "current" ? null : source;
  return (
    2 +
    shown +
    (source.note === "" ? 0 : 1) +
    (turn !== null && turn.preview !== "" ? 1 : 0) +
    (files > LIST_WINDOW ? 2 : 0)
  );
}

// 申报高度：变了才重开（\`openPane\` 会催一次重拉，每帧都调就成了循环）。
async function syncRows($) {
  const rows = desiredRows();
  if (rows === declaredRows) return;
  declaredRows = rows;
  await $.ui.open({ id: PANE_ID, title: TITLE, rows: rows }).catch(function () {});
}

// 换视图之后固定动作：先改高度（它自己会催一次重拉），再标记树过期。
async function rerender($) {
  await syncRows($);
  $.ui.invalidate("ui.render");
}

function sourceOptions() {
  const options = [{ value: "current", label: "Current" }];
  const turns = cache.turns;
  for (
    let index = 0;
    index < turns.length && index < MAX_SOURCES;
    index = index + 1
  ) {
    options.push({
      value: String(turns[index].index),
      label: "T" + String(turns[index].index),
    });
  }
  return options;
}

function renderList($, e) {
  const { Box, Text, Button, Select } = $.ui.resolve(e);
  const source = currentSource();
  const files = source.files;
  const top = clampTop(listTop, files.length);
  const below = files.length - top - LIST_WINDOW;
  const windowFiles = files.slice(top, top + LIST_WINDOW);
  let added = 0;
  let removed = 0;
  for (let index = 0; index < files.length; index = index + 1) {
    added = added + files[index].additions;
    removed = removed + files[index].deletions;
  }
  const turn = sourceKey === "current" ? null : source;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Select
          key="source"
          label="Source"
          options={sourceOptions()}
          value={sourceKey}
          onSelect={function (value) {
            return selectSource($, value);
          }}
        />
        <Text dimColor>{String(files.length) + " files changed"}</Text>
        {added > 0 ? <Text color="diffAdded">{"+" + String(added)}</Text> : null}
        {removed > 0 ? (
          <Text color="diffRemoved">{"-" + String(removed)}</Text>
        ) : null}
      </Box>
      {turn !== null && turn.preview !== "" ? (
        <Text dimColor>{turn.preview}</Text>
      ) : null}
      {source.note !== "" ? <Text dimColor>{source.note}</Text> : null}
      {top > 0 ? (
        <Button
          key="list-up"
          plain
          dimColor
          onPress={function () {
            return scrollList($, -LIST_WINDOW);
          }}
        >
          {"↑ " + String(top) + " more above"}
        </Button>
      ) : null}
      {/* 面板打开时焦点落在第一个文件上（autoFocus）：不这么写它落在来源下拉上，
          Enter 会展开下拉而不是打开文件。 */}
      {windowFiles.map(function (file, index) {
        return (
          <Button
            key={"file:" + file.path}
            autoFocus={index === 0}
            onPress={function () {
              return openFile($, file.path);
            }}
          >
            <Text>{file.path}</Text>
            <Text> </Text>
            {file.additions > 0 ? (
              <Text color="diffAdded">{"+" + String(file.additions)}</Text>
            ) : null}
            {file.additions > 0 && file.deletions > 0 ? <Text> </Text> : null}
            {file.deletions > 0 ? (
              <Text color="diffRemoved">{"-" + String(file.deletions)}</Text>
            ) : null}
          </Button>
        );
      })}
      {below > 0 ? (
        <Button
          key="list-down"
          plain
          dimColor
          onPress={function () {
            return scrollList($, LIST_WINDOW);
          }}
        >
          {"↓ " + String(below) + " more"}
        </Button>
      ) : null}
      <Text dimColor>{HINT_LIST}</Text>
    </Box>
  );
}

function renderDetail($, e) {
  const { Box, Text, Button, Code } = $.ui.resolve(e);
  const file = selectedFile();
  if (file === null) return renderList($, e);
  const lines = splitLines(file.text);
  const window = detailWindow(file);
  const slice = detailSlice(lines, window);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button
          key="back"
          hotkey="b"
          onPress={function () {
            return showList($);
          }}
        >
          {"← Back"}
        </Button>
        <Text dimColor>{file.path}</Text>
      </Box>
      {file.text === "" ? (
        <Text dimColor>
          {"No text diff to show (" +
            (file.note === "" ? "empty file" : file.note) +
            ")"}
        </Text>
      ) : (
        <Code source={slice.lines.join("\\n")} format="diff" />
      )}
      {file.truncated ? (
        <Text dimColor>
          {"Diff truncated: showing the first " + String(MAX_LINES) + " lines"}
        </Text>
      ) : null}
      <Text dimColor>{HINT_DETAIL}</Text>
    </Box>
  );
}

function showList($) {
  view = "list";
  selectedPath = "";
  detailTop = 0;
  return rerender($);
}

function openFile($, path) {
  selectedPath = path;
  view = "detail";
  detailTop = 0;
  return rerender($);
}

function scrollList($, delta) {
  listTop = clampTop(listTop + delta, currentSource().files.length);
  $.ui.invalidate("ui.render");
  return Promise.resolve();
}

function selectSource($, value) {
  sourceKey = typeof value === "string" ? value : "current";
  view = "list";
  selectedPath = "";
  listTop = 0;
  detailTop = 0;
  return rerender($);
}

// 方向键的落点（spec「ui.focus：方向键先问 mod」）：列表视图里 \`↑\`/\`↓\` 归文件
// 列表 —— 候选落在一个文件行上就接住、把焦点挪过去。候选落在翻页行上说明用户
// 走出了当前窗口，这时按方向键带着窗口一起挪（落点是刚进来的那一行），与 Claude
// Code 的 inline 分支一致；详情视图与其它情况一概不接，落回 surface 自己滚正文。
function focusLanding($, e) {
  if (view !== "list") return undefined;
  const candidate = typeof e.element === "string" ? e.element : "";
  const files = currentSource().files;
  const top = clampTop(listTop, files.length);
  const visible = files.slice(top, top + LIST_WINDOW);
  for (let index = 0; index < visible.length; index += 1) {
    if ("file:" + visible[index].path === candidate) {
      return { element: candidate };
    }
  }
  if (candidate === "list-down" && top + LIST_WINDOW < files.length) {
    listTop = top + 1;
    $.ui.invalidate("ui.render");
    return { element: "file:" + files[top + LIST_WINDOW].path };
  }
  if ((candidate === "list-up" || candidate === "source") && top > 0) {
    listTop = top - 1;
    $.ui.invalidate("ui.render");
    return { element: "file:" + files[top - 1].path };
  }
  return undefined;
}

export function register($, on) {
  // 只在终端里注册 \`/diff\`：桌面端与 IDE 有原生的差异面板，再挂一个 mod 面板
  // 就是同一份东西画两遍。\`$.session.surfaces()\` 是「这一刻有没有界面、是哪一端」
  // 的唯一数据源（\`wave -p\` 也是正常会话，但它是空数组）。
  on("session.start", async function () {
    const surfaces = await $.session.surfaces();
    if (surfaces.indexOf("terminal") < 0) return;
    $.command.register({
      name: "diff",
      description: "Show uncommitted changes and edits from earlier turns",
    });
  });

  // \`/diff\` 是一个纯开关动作：只开面板，**不往对话里发消息**（返回 \`{}\`）。
  on("command.run", { command: "diff" }, async function () {
    const root = await $.session.root();
    cache = {
      current: await loadCurrent($, root),
      turns: await loadTurns($, root),
    };
    sourceKey = "current";
    view = "list";
    selectedPath = "";
    listTop = 0;
    detailTop = 0;
    declaredRows = desiredRows();
    const placed = await $.ui.open({
      id: PANE_ID,
      title: TITLE,
      focus: true,
      rows: declaredRows,
    });
    if (!placed.isPlaced) $.ui.status("The diff panel needs a terminal UI");
    $.ui.invalidate("ui.render");
    return {};
  });

  on("ui.render", { component: "Pane", requestId: PANE_ID }, function (e) {
    if (!e) return undefined;
    // 正文能画多少行由 surface 量（spec「ui.render 的 e.props」）：详情按它剪窗口，
    // 剪完的树正好装得下，底部的键位提示才钉得住。
    const rows = e.props && e.props.scroll ? e.props.scroll.bodyRows : 0;
    if (typeof rows === "number" && rows > 0) bodyRows = rows;
    return view === "detail" ? renderDetail($, e) : renderList($, e);
  });

  // 方向键先问一遍插件（spec「ui.focus」）：接住就换选中项，不接就归 surface
  // 滚正文 —— 这就是列表里 \`↑\`/\`↓\` 换文件、详情里滚正文的那条分岔。
  on("ui.focus", { component: "Pane", requestId: PANE_ID }, function (e) {
    if (!e) return undefined;
    return focusLanding($, e);
  });

  // 滚动先问一遍插件（spec「ui.scroll」）：详情里收下它 —— 面板自己挪窗口、
  // 重画一帧，于是整棵树永远装得下，键位提示钉在面板底边；列表视图不接，落回
  // surface 的默认滚动（列表本来就只有一屏，没有可滚的）。
  on("ui.scroll", { component: "Pane", requestId: PANE_ID }, function (e) {
    if (!e || view !== "detail") return undefined;
    const file = selectedFile();
    if (file === null) return undefined;
    const lines = splitLines(file.text);
    const window = detailWindow(file);
    const maxTop = lines.length > window ? lines.length - window : 0;
    const by = typeof e.by === "number" ? e.by : 0;
    const next = detailTop + by;
    const top = next < 0 ? 0 : next > maxTop ? maxTop : next;
    // 到顶 / 到底也接住：这一下归插件，surface 不必再滚（它的滚动层对详情是空的）。
    if (top === detailTop) return {};
    detailTop = top;
    $.ui.invalidate("ui.render");
    return {};
  });

  // \`Esc\` 先问能不能关（spec「ui.close」）：详情里它不是收盘，是**回列表** ——
  // 拦下这次关闭、把面板画回列表（与 Claude Code 的 \`deny\` 同一种用法）。列表里
  // 不拦，让它照常关掉。
  on("ui.close", function (e) {
    if (!e || e.id !== PANE_ID) return undefined;
    if (view !== "detail") return undefined;
    void showList($);
    return { deny: "back to the file list" };
  });
}
`,
};
