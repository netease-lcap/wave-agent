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
  "- 阶段衔接一律用 AskUserQuestion 单选让用户点击决策，不要求自然语言：spec 确认（确认通过/需要修改）、是否制作原型、是否制定技术方案（plan）均通过单选推进。",
  "- 可选原型阶段（在规格之后、plan 之前）：仅实现前端界面，数据全部使用 mock；可选 plan 阶段：进入 plan 模式制定技术方案，批准后再编码。二者均可跳过——最短流程=规格+编码，最长=规格+原型+plan+编码。仅当需求涉及前端界面时才询问是否制作原型，无前端界面的需求（后端服务、CLI、算法库等）直接跳过原型询问。",
  "- 用 task 工具追踪进度：规格、原型、plan、编码各阶段开始前用 TaskCreate 创建任务并标记进行中（TaskUpdate），完成/批准/确认后标记完成，让用户在任务列表中看到当前所处阶段。",
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
description: 根据自然语言描述创建或更新功能规格说明，并通过单选衔接可选原型、技术方案（plan）与编码阶段。
user-invocable: false
---

## 用户输入

\`\`\`text
$ARGUMENTS
\`\`\`

## 流程

本技能由 AI 在会话中自动触发（不占用手动斜杠命令）。触发时机：用户提出新的需求、修改需求或涉及功能边界时，若对应规格尚未创建或已过期，则主动创建或更新规格说明。$ARGUMENTS 通常为空——需求描述直接来自对话上下文，不要让用户重复。

根据对话中的功能描述，执行以下步骤：

0. **创建进度任务**：用 TaskCreate 创建「编写功能规格」任务，并用 TaskUpdate 标记进行中。后续每个阶段（原型、plan、编码）同样在开始前创建任务、结束后更新状态，让用户在任务列表中看到当前进度。

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
   - 输出规格文件路径，并通过 AskUserQuestion 单选请求确认（选项：确认通过 / 需要修改）
   - 选「需要修改」→ 按用户反馈更新规格后重新校验，并再次单选确认；选「确认通过」→ 将「编写功能规格」任务标记完成

6. **询问是否制作原型（可选阶段，位于规格之后、plan 之前）**：
   - 仅当需求涉及前端界面时弹出询问；需求不涉及前端界面（如后端服务、CLI 工具、算法库）时，跳过本阶段直接进入下一步，不弹出原型选择
   - 通过 AskUserQuestion 单选询问（选项：制作原型 / 跳过）
   - 选「制作原型」→ 用 TaskCreate 创建「制作原型」任务并标记进行中；仅实现前端界面，数据全部使用 mock（不接后端、不接真实数据）；完成后展示可交互原型供用户查看，并将任务标记完成
   - 选「跳过」→ 直接进入下一步

7. **询问是否制定技术方案（可选 plan 阶段）**：
   - 通过 AskUserQuestion 单选询问（选项：进入 plan 模式 / 跳过）
   - 选「进入 plan 模式」→ 用 TaskCreate 创建「制定技术方案」任务并标记进行中；调用 EnterPlanMode 进入 plan 模式，制定技术方案（技术选型、架构设计、实现步骤）并写入计划文件；用 ExitPlanMode 请求批准——被拒绝则按反馈更新方案后重新请求，批准后标记任务完成
   - 选「跳过」→ 直接进入下一步

8. **编码阶段**：
   - 用 TaskCreate 创建「实现功能」任务并标记进行中
   - 按已确认的规格实现；若制作了原型则遵循其交互设计，若批准了技术方案则遵循其架构
   - 实现完成后将任务标记完成

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
