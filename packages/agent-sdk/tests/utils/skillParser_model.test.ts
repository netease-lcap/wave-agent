import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { parseSkillFile } from "../../src/utils/skillParser.js";

// Mock fs module
vi.mock("fs");

const mockReadFileSync = vi.mocked(readFileSync);

describe("skillParser model field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse model field in frontmatter", () => {
    const mockContent = `---
name: test-skill
description: A test skill for validation
model: gpt-4o
---

# Test Skill`;

    mockReadFileSync.mockReturnValue(mockContent);

    const result = parseSkillFile("/path/to/test-skill/SKILL.md");

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.model).toBe("gpt-4o");
  });

  it("should handle missing model field", () => {
    const mockContent = `---
name: test-skill
description: A test skill for validation
---

# Test Skill`;

    mockReadFileSync.mockReturnValue(mockContent);

    const result = parseSkillFile("/path/to/test-skill/SKILL.md");

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.model).toBeUndefined();
  });
});
