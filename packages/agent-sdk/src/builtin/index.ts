import { artifactSkill } from "./skills/artifact.js";
import { code_reviewSkill } from "./skills/code-review.js";
import { deep_researchSkill } from "./skills/deep-research.js";
import { initSkill } from "./skills/init.js";
import { loopSkill } from "./skills/loop.js";
import { simplifySkill } from "./skills/simplify.js";
import { settingsSkills } from "./skills/settings.js";
import { subagents } from "./subagents.js";
import { sddPlugin } from "./plugins.js";

export const BUILTIN_CONTENT: Record<string, string> = {
  ...artifactSkill,
  ...code_reviewSkill,
  ...deep_researchSkill,
  ...initSkill,
  ...loopSkill,
  ...simplifySkill,
  ...settingsSkills,
  ...subagents,
  ...sddPlugin,
};
