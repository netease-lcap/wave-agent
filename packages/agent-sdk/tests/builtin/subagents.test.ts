import { describe, it, expect } from "vitest";
import { subagents } from "../../src/builtin/subagents.js";
import {
  ARTIFACT_COMMENTS_TOOL_NAME,
  ARTIFACT_TOOL_NAME,
} from "../../src/constants/tools.js";

// The read-only built-ins blacklist by name, so every tool that can write to the
// outside world has to be listed. Splitting comment actions into their own tool
// used to slip past this: `Artifact` was blacklisted, `ArtifactComments` was not,
// which left Explore/Plan able to post a public reply.
describe("read-only built-in subagents", () => {
  for (const name of ["Explore", "Plan"]) {
    it(`${name} cannot publish or comment`, () => {
      const body = Object.values(subagents).find((b) =>
        b.includes(`\nname: ${name}\n`),
      );
      expect(body).toBeDefined();
      const line = body!
        .split("\n")
        .find((l) => l.startsWith("disallowedTools:"));
      expect(line).toBeDefined();
      expect(line).toContain(ARTIFACT_TOOL_NAME);
      expect(line).toContain(ARTIFACT_COMMENTS_TOOL_NAME);
    });
  }
});
