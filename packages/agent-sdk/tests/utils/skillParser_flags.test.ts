import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { dirname } from "path";
import { parseSkillFile } from "../../src/utils/skillParser.js";

// Mock fs module
vi.mock("fs");

const mockReadFileSync = vi.mocked(readFileSync);

describe("skillParser flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseSkillFile with flags", () => {
    it("should parse disable-model-invocation: true", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disable-model-invocation: true
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.disableModelInvocation).toBe(true);
    });

    it('should parse disable-model-invocation: "true" (string)', () => {
      const mockContent = `---
name: test-skill
description: A test skill
disable-model-invocation: "true"
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.disableModelInvocation).toBe(true);
    });

    it("should default disable-model-invocation to false", () => {
      const mockContent = `---
name: test-skill
description: A test skill
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.disableModelInvocation).toBe(false);
    });

    it("should parse user-invocable: false", () => {
      const mockContent = `---
name: test-skill
description: A test skill
user-invocable: false
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.userInvocable).toBe(false);
    });

    it('should parse user-invocable: "false" (string)', () => {
      const mockContent = `---
name: test-skill
description: A test skill
user-invocable: "false"
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.userInvocable).toBe(false);
    });

    it("should default user-invocable to true", () => {
      const mockContent = `---
name: test-skill
description: A test skill
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.userInvocable).toBe(true);
    });

    it("should parse both flags together", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disable-model-invocation: true
user-invocable: false
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.disableModelInvocation).toBe(true);
      expect(result.skillMetadata.userInvocable).toBe(false);
    });
  });

  // spec ecosystem/agent-skills「技能里的工具黑名单」
  describe("disallowed-tools", () => {
    it("parses a YAML list", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disallowed-tools:
  - Bash(rm:*)
  - Write
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.skillMetadata.disallowedTools).toEqual([
        "Bash(rm:*)",
        "Write",
      ]);
    });

    it("parses a comma-separated string and trims each rule", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disallowed-tools: " Bash(rm:*),Write "
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.skillMetadata.disallowedTools).toEqual([
        "Bash(rm:*)",
        "Write",
      ]);
    });

    it("reads the camel-case `disallowedTools` spelling too", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disallowedTools:
  - Bash(rm:*)
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.skillMetadata.disallowedTools).toEqual(["Bash(rm:*)"]);
    });

    it("prefers the kebab field when both spellings are present", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disallowed-tools: Write
disallowedTools:
  - Bash(rm:*)
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.skillMetadata.disallowedTools).toEqual(["Write"]);
    });

    it("resolves ${WAVE_SKILL_DIR} the same way allowed-tools does", () => {
      const filePath = "/path/to/test-skill/SKILL.md";
      const mockContent = `---
name: test-skill
description: A test skill
allowed-tools:
  - Bash(node \${WAVE_SKILL_DIR}/scripts/run.mjs*)
disallowed-tools:
  - Bash(node \${WAVE_SKILL_DIR}/scripts/dangerous.mjs*)
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile(filePath);
      const skillDir = dirname(filePath);

      expect(result.skillMetadata.allowedTools).toEqual([
        `Bash(node ${skillDir}/scripts/run.mjs*)`,
      ]);
      expect(result.skillMetadata.disallowedTools).toEqual([
        `Bash(node ${skillDir}/scripts/dangerous.mjs*)`,
      ]);
    });

    it("drops a rule whose placeholder has no path and warns about it", () => {
      const mockContent = `---
name: test-skill
description: A test skill
disallowed-tools:
  - Bash(\${WAVE_PLUGIN_ROOT}/bin/wipe*)
  - Write
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      // The unresolved rule is not registered as a no-op; the rest survives.
      expect(result.skillMetadata.disallowedTools).toEqual(["Write"]);
      expect(result.warnings).toEqual([
        expect.stringContaining(
          'disallowed-tools rule "Bash(${WAVE_PLUGIN_ROOT}/bin/wipe*)" keeps ${WAVE_PLUGIN_ROOT}',
        ),
      ]);
    });

    it("leaves disallowed-tools unset when the skill declares only allowed-tools", () => {
      const mockContent = `---
name: test-skill
description: A test skill
allowed-tools:
  - Read
---
# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.skillMetadata.allowedTools).toEqual(["Read"]);
      expect(result.skillMetadata.disallowedTools).toBeUndefined();
    });
  });
});
