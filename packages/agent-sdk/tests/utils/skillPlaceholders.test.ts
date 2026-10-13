import { describe, it, expect } from "vitest";
import {
  findUnresolvedSkillPlaceholders,
  substituteSkillPlaceholders,
} from "../../src/utils/skillPlaceholders.js";

describe("skillPlaceholders", () => {
  const context = { skillPath: "/skills/acme", pluginRoot: "/plugins/acme" };

  it("resolves every spelling of the skill directory token", () => {
    expect(
      substituteSkillPlaceholders(
        "node ${WAVE_SKILL_DIR}/x.mjs and ${CLAUDE_SKILL_DIR}/y.mjs",
        context,
      ),
    ).toBe("node /skills/acme/x.mjs and /skills/acme/y.mjs");
  });

  it("resolves the plugin root tokens when a plugin root is known", () => {
    expect(
      substituteSkillPlaceholders(
        '${WAVE_PLUGIN_ROOT}/a "${CLAUDE_PLUGIN_ROOT}/b"',
        context,
      ),
    ).toBe('/plugins/acme/a "/plugins/acme/b"');
  });

  it("leaves the plugin root tokens alone when there is no plugin root", () => {
    // Nothing sensible to substitute: the caller reports it instead of
    // guessing a path (see findUnresolvedSkillPlaceholders).
    expect(
      substituteSkillPlaceholders("${WAVE_PLUGIN_ROOT}/a", {
        skillPath: "/skills/acme",
      }),
    ).toBe("${WAVE_PLUGIN_ROOT}/a");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(
      substituteSkillPlaceholders(
        "${WAVE_SKILL_DIR} ${WAVE_SKILL_DIR}",
        context,
      ),
    ).toBe("/skills/acme /skills/acme");
  });

  it("leaves unrelated text untouched", () => {
    const text = "Bash(node ./relative.mjs*) ${NOT_OURS} $1 $ARGUMENTS";
    expect(substituteSkillPlaceholders(text, context)).toBe(text);
  });

  it("reports the placeholders that survived substitution", () => {
    expect(findUnresolvedSkillPlaceholders("${WAVE_PLUGIN_ROOT}/a")).toEqual([
      "${WAVE_PLUGIN_ROOT}",
    ]);
    expect(findUnresolvedSkillPlaceholders("/real/path/x.mjs")).toEqual([]);
  });
});
