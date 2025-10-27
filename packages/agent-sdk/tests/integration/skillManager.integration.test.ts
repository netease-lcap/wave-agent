import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Logger, SkillManagerOptions } from "../../src/types.js";

describe("SkillManager Integration Tests", () => {
  let personalSkillsDir: string;
  let projectSkillsDir: string;
  let personalBaseDir: string;
  let skillManager: SkillManager;
  let logger: Logger;

  beforeEach(async () => {
    // Create separate temp directories for personal and project to avoid overlap
    personalBaseDir = join(
      tmpdir(),
      `personal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    );
    const projectTempDir = join(
      tmpdir(),
      `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    );

    personalSkillsDir = join(personalBaseDir, ".wave", "skills");
    projectSkillsDir = join(projectTempDir, ".wave", "skills");

    await mkdir(personalSkillsDir, { recursive: true });
    await mkdir(projectSkillsDir, { recursive: true });

    // Set working directory to project for project skills discovery
    process.chdir(projectTempDir);

    // Create logger
    logger = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
  });

  afterEach(async () => {
    try {
      // Clean up both temp directories
      await rm(personalBaseDir, { recursive: true, force: true });
      await rm(projectSkillsDir.split("/.wave")[0], {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore cleanup errors
    }
  });

  const createSkillManager = (personalSkillsPath?: string): SkillManager => {
    const options: SkillManagerOptions = {
      personalSkillsPath:
        personalSkillsPath || join(personalBaseDir, ".wave", "skills"),
      scanTimeout: 5000,
      logger,
    };

    return new SkillManager(options);
  };

  describe("Personal Skills Workflow", () => {
    it("should discover and execute a personal skill", async () => {
      // Create a personal skill
      const skillDir = join(personalSkillsDir, "my-personal-skill");
      await mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: my-personal-skill
description: A test personal skill for integration testing
---

# My Personal Skill

This is a **personal skill** that demonstrates:

- Skill discovery
- Metadata parsing
- Content loading
- Tool execution

## Usage

This skill can be invoked by the agent to provide structured guidance.

### Features

1. **Frontmatter validation**: Ensures proper YAML metadata
2. **Markdown content**: Rich content formatting
3. **Personal type**: Located in user's home directory

---

**Status**: Ready for use
**Type**: Personal
**Version**: 1.0.0`;

      await writeFile(join(skillDir, "SKILL.md"), skillContent);

      // Initialize skill manager and skill tool
      skillManager = createSkillManager();
      await skillManager.initialize();

      // Check that skill was discovered
      const availableSkills = skillManager.getAvailableSkills();
      expect(availableSkills).toHaveLength(1);
      expect(availableSkills[0].name).toBe("my-personal-skill");
      expect(availableSkills[0].type).toBe("personal");

      // Test skill execution
      const result = await skillManager.executeSkill({
        skill_name: "my-personal-skill",
      });

      expect(result.content).toContain(
        "🧠 **my-personal-skill** (personal skill)",
      );
      expect(result.content).toContain(
        "A test personal skill for integration testing",
      );
      expect(result.content).toContain(
        "This is a **personal skill** that demonstrates",
      );
      expect(result.content).toContain("**Status**: Ready for use");
    });

    it("should handle invalid personal skill gracefully", async () => {
      // Create an invalid personal skill (missing required fields)
      const skillDir = join(personalSkillsDir, "invalid-skill");
      await mkdir(skillDir, { recursive: true });

      const invalidSkillContent = `---
name: ""
description: ""
---

# Invalid Skill

This skill has invalid metadata.`;

      await writeFile(join(skillDir, "SKILL.md"), invalidSkillContent);

      // Initialize skill manager and skill tool
      skillManager = createSkillManager();
      await skillManager.initialize();

      // Invalid skill should not appear in available skills
      const availableSkills = skillManager.getAvailableSkills();
      expect(
        availableSkills.find((skill) => skill.name === "invalid-skill"),
      ).toBeUndefined();

      // Attempting to execute should show helpful error
      const result = await skillManager.executeSkill({
        skill_name: "invalid-skill",
      });
      expect(result.content).toContain(
        '❌ **Skill not found**: "invalid-skill"',
      );
    });
  });

  describe("Project Skills Workflow", () => {
    it("should discover and execute a project skill", async () => {
      // Create a project skill
      const skillDir = join(projectSkillsDir, "project-deployment");
      await mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: project-deployment
description: Deploy the current project to staging environment
---

# Project Deployment Skill

This is a **project-specific skill** for deployment workflows.

## Deployment Steps

1. **Build**: Compile the project
2. **Test**: Run integration tests  
3. **Deploy**: Push to staging environment
4. **Verify**: Check deployment status

## Configuration

- **Environment**: Staging
- **Region**: us-west-2
- **Timeout**: 300 seconds

## Commands

\`\`\`bash
npm run build
npm run test:integration
npm run deploy:staging
\`\`\`

---

**Team**: DevOps
**Maintainer**: platform-team@company.com
**Last Updated**: 2024-01-15`;

      await writeFile(join(skillDir, "SKILL.md"), skillContent);

      // Initialize skill manager and skill tool (should auto-discover project skills in cwd)
      skillManager = createSkillManager();
      await skillManager.initialize();

      // Check that project skill was discovered
      const availableSkills = skillManager.getAvailableSkills();
      const projectSkill = availableSkills.find(
        (skill) => skill.name === "project-deployment",
      );
      expect(projectSkill).toBeDefined();
      expect(projectSkill?.type).toBe("project");

      // Test skill execution
      const result = await skillManager.executeSkill({
        skill_name: "project-deployment",
      });

      expect(result.content).toContain(
        "🧠 **project-deployment** (project skill)",
      );
      expect(result.content).toContain(
        "Deploy the current project to staging environment",
      );
      expect(result.content).toContain("This is a **project-specific skill**");
      expect(result.content).toContain("npm run deploy:staging");
      expect(result.content).toContain("**Team**: DevOps");
    });
  });

  describe("Skill Priority and Overrides", () => {
    it("should prioritize project skills over personal skills", async () => {
      // Create the same skill in both personal and project directories
      const skillName = "shared-skill";

      // Personal skill
      const personalSkillDir = join(personalSkillsDir, skillName);
      await mkdir(personalSkillDir, { recursive: true });
      await writeFile(
        join(personalSkillDir, "SKILL.md"),
        `---
name: ${skillName}
description: Personal version of shared skill
---

# Personal Shared Skill

This is the **personal version** of the shared skill.`,
      );

      // Project skill (should override personal)
      const projectSkillDir = join(projectSkillsDir, skillName);
      await mkdir(projectSkillDir, { recursive: true });
      await writeFile(
        join(projectSkillDir, "SKILL.md"),
        `---
name: ${skillName}
description: Project version of shared skill (overrides personal)
---

# Project Shared Skill

This is the **project version** of the shared skill that overrides the personal one.`,
      );

      // Initialize skill manager and skill tool
      skillManager = createSkillManager();
      await skillManager.initialize();

      // Check that project skill takes priority
      const availableSkills = skillManager.getAvailableSkills();
      const sharedSkill = availableSkills.find(
        (skill) => skill.name === skillName,
      );
      expect(sharedSkill).toBeDefined();
      expect(sharedSkill?.type).toBe("project");
      expect(sharedSkill?.description).toBe(
        "Project version of shared skill (overrides personal)",
      );

      // Execute skill - should get project version
      const result = await skillManager.executeSkill({ skill_name: skillName });

      expect(result.content).toContain("🧠 **shared-skill** (project skill)");
      expect(result.content).toContain(
        "Project version of shared skill (overrides personal)",
      );
      expect(result.content).toContain("This is the **project version**");
      expect(result.content).not.toContain("This is the **personal version**");
    });
  });

  describe("Skill Error Handling", () => {
    it("should provide helpful feedback for skill not found", async () => {
      // Create one valid skill for context
      const skillDir = join(personalSkillsDir, "existing-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: existing-skill
description: An existing skill for context
---

# Existing Skill`,
      );

      skillManager = createSkillManager();
      await skillManager.initialize();

      // Try to execute non-existent skill
      const result = await skillManager.executeSkill({
        skill_name: "non-existent-skill",
      });

      expect(result.content).toContain(
        '❌ **Skill not found**: "non-existent-skill"',
      );
    });

    it("should handle malformed YAML frontmatter gracefully", async () => {
      // Create skill with malformed YAML
      const skillDir = join(personalSkillsDir, "malformed-skill");
      await mkdir(skillDir, { recursive: true });

      const malformedContent = `---
name: malformed-skill
description: "Unclosed quote
invalid: yaml: [content
really: {broken yaml without closing
---

# Malformed Skill

This skill has invalid YAML frontmatter.`;

      await writeFile(join(skillDir, "SKILL.md"), malformedContent);

      skillManager = createSkillManager();
      await skillManager.initialize();

      // Test that malformed YAML still results in discoverable skill but with issues
      const result = await skillManager.executeSkill({
        skill_name: "malformed-skill",
      });

      expect(result.content).toContain("🧠 **malformed-skill**");
      expect(result.content).toContain("personal skill"); // Should still be discoverable
      expect(result.content).toContain("Unclosed quote"); // Description from malformed YAML
    });

    it("should handle missing SKILL.md file", async () => {
      // Create skill directory but no SKILL.md file
      const skillDir = join(personalSkillsDir, "no-skill-file");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "README.md"),
        "This is not a SKILL.md file",
      );

      skillManager = createSkillManager();
      await skillManager.initialize();

      // Try to execute skill with missing file
      const result = await skillManager.executeSkill({
        skill_name: "no-skill-file",
      });

      expect(result.content).toContain(
        '❌ **Skill not found**: "no-skill-file"',
      );
    });
  });

  describe("Multiple Skills Workflow", () => {
    it("should handle multiple skills from different sources", async () => {
      // Create multiple personal skills
      const personalSkills = [
        { name: "personal-skill-1", description: "First personal skill" },
        { name: "personal-skill-2", description: "Second personal skill" },
      ];

      for (const skill of personalSkills) {
        const skillDir = join(personalSkillsDir, skill.name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, "SKILL.md"),
          `---
name: ${skill.name}
description: ${skill.description}
---

# ${skill.name.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}

Content for ${skill.description.toLowerCase()}.`,
        );
      }

      // Create multiple project skills
      const projectSkills = [
        { name: "project-skill-1", description: "First project skill" },
        { name: "project-skill-2", description: "Second project skill" },
      ];

      for (const skill of projectSkills) {
        const skillDir = join(projectSkillsDir, skill.name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, "SKILL.md"),
          `---
name: ${skill.name}
description: ${skill.description}
---

# ${skill.name.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}

Content for ${skill.description.toLowerCase()}.`,
        );
      }

      skillManager = createSkillManager();
      await skillManager.initialize();

      // Check all skills are available
      const availableSkills = skillManager.getAvailableSkills();
      expect(availableSkills).toHaveLength(4);

      // Check that skills from both sources are present
      const personalSkillNames = availableSkills
        .filter((s) => s.type === "personal")
        .map((s) => s.name);
      const projectSkillNames = availableSkills
        .filter((s) => s.type === "project")
        .map((s) => s.name);

      expect(personalSkillNames).toContain("personal-skill-1");
      expect(personalSkillNames).toContain("personal-skill-2");
      expect(projectSkillNames).toContain("project-skill-1");
      expect(projectSkillNames).toContain("project-skill-2");

      // Test execution of different skill types
      const personalResult = await skillManager.executeSkill({
        skill_name: "personal-skill-1",
      });
      expect(personalResult.content).toContain(
        "🧠 **personal-skill-1** (personal skill)",
      );

      const projectResult = await skillManager.executeSkill({
        skill_name: "project-skill-1",
      });
      expect(projectResult.content).toContain(
        "🧠 **project-skill-1** (project skill)",
      );
    });
  });
});
