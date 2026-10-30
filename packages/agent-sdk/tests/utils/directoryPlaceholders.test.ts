import { describe, it, expect } from "vitest";
import {
  findUnresolvedDirectoryPlaceholders,
  substituteDirectoryPlaceholders,
} from "../../src/utils/directoryPlaceholders.js";

describe("directoryPlaceholders", () => {
  const context = { skillPath: "/skills/acme", pluginRoot: "/plugins/acme" };

  it("resolves every spelling of the skill directory token", () => {
    expect(
      substituteDirectoryPlaceholders(
        "node ${WAVE_SKILL_DIR}/x.mjs and ${CLAUDE_SKILL_DIR}/y.mjs",
        context,
      ),
    ).toBe("node /skills/acme/x.mjs and /skills/acme/y.mjs");
  });

  it("resolves the plugin root tokens when a plugin root is known", () => {
    expect(
      substituteDirectoryPlaceholders(
        '${WAVE_PLUGIN_ROOT}/a "${CLAUDE_PLUGIN_ROOT}/b"',
        context,
      ),
    ).toBe('/plugins/acme/a "/plugins/acme/b"');
  });

  it("leaves the plugin root tokens alone when there is no plugin root", () => {
    // Nothing sensible to substitute: the caller reports it instead of
    // guessing a path (see findUnresolvedDirectoryPlaceholders).
    expect(
      substituteDirectoryPlaceholders("${WAVE_PLUGIN_ROOT}/a", {
        skillPath: "/skills/acme",
      }),
    ).toBe("${WAVE_PLUGIN_ROOT}/a");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(
      substituteDirectoryPlaceholders(
        "${WAVE_SKILL_DIR} ${WAVE_SKILL_DIR}",
        context,
      ),
    ).toBe("/skills/acme /skills/acme");
  });

  it("leaves unrelated text untouched", () => {
    const text = "Bash(node ./relative.mjs*) ${NOT_OURS} $1 $ARGUMENTS";
    expect(substituteDirectoryPlaceholders(text, context)).toBe(text);
  });

  it("reports the placeholders that survived substitution", () => {
    expect(
      findUnresolvedDirectoryPlaceholders("${WAVE_PLUGIN_ROOT}/a"),
    ).toEqual(["${WAVE_PLUGIN_ROOT}"]);
    expect(findUnresolvedDirectoryPlaceholders("/real/path/x.mjs")).toEqual([]);
  });

  // A plugin command has a plugin root but no skill directory of its own
  // (spec `commands/slash-commands`「插件命令正文可用插件根占位符」).
  it("resolves the plugin root for content that has no skill directory", () => {
    expect(
      substituteDirectoryPlaceholders("node ${CLAUDE_PLUGIN_ROOT}/x.mjs", {
        pluginRoot: "/plugins/acme",
      }),
    ).toBe("node /plugins/acme/x.mjs");
  });

  it("resolves nothing, and reports both families, without any source", () => {
    const text = "${WAVE_SKILL_DIR}/a ${WAVE_PLUGIN_ROOT}/b";

    expect(substituteDirectoryPlaceholders(text, {})).toBe(text);
    expect(findUnresolvedDirectoryPlaceholders(text)).toEqual([
      "${WAVE_SKILL_DIR}",
      "${WAVE_PLUGIN_ROOT}",
    ]);
  });
});
