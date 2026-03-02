import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
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
});
