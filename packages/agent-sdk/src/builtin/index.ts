import { artifactSkill } from "./skills/artifact.js";
import { code_reviewSkill } from "./skills/code-review.js";
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
