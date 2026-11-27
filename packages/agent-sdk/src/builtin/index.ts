import { artifactSkill } from "./skills/artifact.js";
import {
  code_reviewSkill,
  code_reviewSkillHooks,
} from "./skills/code-review.js";
import { initSkill } from "./skills/init.js";
import { loopSkill } from "./skills/loop.js";
import { runSkill } from "./skills/run.js";
import { runSkillGeneratorSkill } from "./skills/run-skill-generator.js";
import { security_reviewSkill } from "./skills/security-review.js";
import { simplifySkill } from "./skills/simplify.js";
import { settingsSkills } from "./skills/settings.js";
import { verifySkill } from "./skills/verify.js";
import { waveDaemonSkill } from "./skills/wave-daemon.js";
import { workflowAuthoringSkill } from "./skills/workflow-authoring.js";
import { subagents } from "./subagents.js";
import { diffPlugin, sddPlugin } from "./plugins.js";
import type { BuiltinSkillHook } from "./skillHooks.js";

/**
 * 内置技能的代码钩子，按技能名索引。
 *
 * 内置技能落盘成 SKILL.md 再扫回来，代码能力会在那一步丢掉；这张旁挂表把它接回去，
 * 只对 `skill.type === "builtin"` 生效。文件来源（用户 / 项目 / 插件）永远查不到——
 * markdown 侧不加字段是刻意的，见 `skillHooks.ts`。
 */
export const BUILTIN_SKILL_HOOKS: Record<string, BuiltinSkillHook> = {
  ...code_reviewSkillHooks,
};

export const BUILTIN_CONTENT: Record<string, string> = {
  ...artifactSkill,
  ...code_reviewSkill,
  ...initSkill,
  ...loopSkill,
  ...security_reviewSkill,
  ...simplifySkill,
  ...runSkill,
  ...runSkillGeneratorSkill,
  ...verifySkill,
  ...settingsSkills,
  ...waveDaemonSkill,
  ...workflowAuthoringSkill,
  ...subagents,
  ...sddPlugin,
  ...diffPlugin,
};
