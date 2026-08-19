import React from "react";
import { render } from "ink-testing-library";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import {
  SkillsManager,
  SkillsManagerProps,
} from "../../src/components/SkillsManager.js";
import type { SkillMetadata } from "wave-agent-sdk";

const mockSkills: SkillMetadata[] = [
  {
    name: "deep-research",
    description: "Deep research with web search",
    type: "builtin",
    skillPath: "/usr/local/lib/.wave/skills/deep-research",
  },
  {
    name: "my-skill",
    description: "Personal skill",
    type: "personal",
    skillPath: "~/.wave/skills/my-skill",
  },
  {
    name: "project-skill",
    description: "Project-specific skill",
    type: "project",
    skillPath: ".wave/skills/project-skill",
    model: "claude-sonnet-4-5",
    allowedTools: ["Bash", "Read"],
  },
  {
    name: "my-plugin:helper",
    description: "Skill provided by a plugin",
    type: "builtin",
    skillPath: "/plugins/my-plugin/skills/helper",
    pluginName: "my-plugin",
  },
];

describe("SkillsManager", () => {
  let mockOnCancel: Mock<() => void>;
  let defaultProps: SkillsManagerProps;

  beforeEach(() => {
    mockOnCancel = vi.fn<() => void>();
    defaultProps = {
      onCancel: mockOnCancel,
      skills: mockSkills,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list view", () => {
    it("should show header and hint", () => {
      const { lastFrame } = render(<SkillsManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("Skills");
      expect(output).toContain("Select a skill to view details");
    });

    it("should display skills grouped by scope", () => {
      const { lastFrame } = render(<SkillsManager {...defaultProps} />);
      const output = lastFrame();

      // Scope group headers
      expect(output).toContain("Built-in skills");
      expect(output).toContain("User skills");
      expect(output).toContain("Project skills");
      expect(output).toContain("Plugin skills");

      // Skill names
      expect(output).toContain("deep-research");
      expect(output).toContain("my-skill");
      expect(output).toContain("project-skill");
      expect(output).toContain("my-plugin:helper");

      // Plugin name shown next to plugin skills
      expect(output).toContain("· my-plugin");
    });

    it("should show navigation instructions", () => {
      const { lastFrame } = render(<SkillsManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("↑/↓ to select");
      expect(output).toContain("Enter to view details");
      expect(output).toContain("Esc to close");
    });

    it("should show empty state when no skills", () => {
      const props = {
        ...defaultProps,
        skills: [],
      };
      const { lastFrame } = render(<SkillsManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("No skills available");
      expect(output).toContain(
        "Create skills in .wave/skills/ or ~/.wave/skills/",
      );
      expect(output).toContain("Press Escape to close");
    });

    it("should hide group headers for empty scopes", () => {
      const props = {
        ...defaultProps,
        skills: mockSkills.filter((s) => s.type === "project"),
      };
      const { lastFrame } = render(<SkillsManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("Project skills");
      expect(output).not.toContain("Built-in skills");
      expect(output).not.toContain("User skills");
      expect(output).not.toContain("Plugin skills");
    });
  });

  describe("navigation", () => {
    it("should change selection with arrow keys", async () => {
      const { lastFrame, stdin } = render(<SkillsManager {...defaultProps} />);

      // First selectable entry is deep-research (builtin, first scope)
      expect(lastFrame()).toContain("▶ 1. deep-research");

      // Move down past deep-research + my-skill + project-skill + helper
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      // Last selectable entry is the plugin skill
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 4. my-plugin:helper"),
      );
    });

    it("should clamp selection at the bottom", async () => {
      const { lastFrame, stdin } = render(<SkillsManager {...defaultProps} />);

      for (let i = 0; i < 10; i++) {
        stdin.write("\u001B[B");
      }
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 4. my-plugin:helper"),
      );
    });

    it("should enter detail view on Enter and go back on Escape", async () => {
      const { lastFrame, stdin } = render(<SkillsManager {...defaultProps} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Skill: deep-research"),
      );

      // Detail shows all fields
      const output = lastFrame();
      expect(output).toContain("Description:");
      expect(output).toContain("Scope:");
      expect(output).toContain("Path:");
      expect(output).toContain("Invocation:");
      expect(output).toContain("Esc or Enter to go back");

      // Back to list
      stdin.write("\u001B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Select a skill to view details"),
      );
    });

    it("should call onCancel on Escape in list view", async () => {
      const { stdin } = render(<SkillsManager {...defaultProps} />);

      stdin.write("\u001B");
      await vi.waitFor(() => expect(mockOnCancel).toHaveBeenCalled());
    });

    it("should ignore arrow keys in detail view", async () => {
      const { lastFrame, stdin } = render(<SkillsManager {...defaultProps} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Skill: deep-research"),
      );

      // Arrow down in detail must not change the selected entry
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Skill: deep-research"),
      );
      expect(lastFrame()).toContain("Deep research with web search");
    });
  });

  describe("detail view content", () => {
    it("should show model, allowed tools and plugin info when configured", async () => {
      const { lastFrame, stdin } = render(<SkillsManager {...defaultProps} />);

      // Move to project-skill (3rd entry) and open detail
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Skill: project-skill"),
      );
      const output = lastFrame();

      expect(output).toContain("Project-specific skill");
      expect(output).toContain("claude-sonnet-4-5");
      expect(output).toContain("Bash, Read");
    });

    it("should show invocation restrictions when configured", async () => {
      const props = {
        ...defaultProps,
        skills: [
          {
            ...mockSkills[0],
            userInvocable: false,
            disableModelInvocation: true,
          },
        ],
      };
      const { lastFrame, stdin } = render(<SkillsManager {...props} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Skill: deep-research"),
      );
      expect(lastFrame()).toContain("not user-invocable");
      expect(lastFrame()).toContain("model invocation disabled");
    });
  });

  describe("component lifecycle", () => {
    it("should cleanup properly on unmount", () => {
      const { unmount } = render(<SkillsManager {...defaultProps} />);

      expect(() => unmount()).not.toThrow();
    });

    it("should handle skill prop changes", () => {
      const { rerender, lastFrame } = render(
        <SkillsManager {...defaultProps} />,
      );

      // A new skill is added
      rerender(
        <SkillsManager
          {...defaultProps}
          skills={[
            ...defaultProps.skills,
            {
              name: "another-skill",
              description: "Another skill",
              type: "personal",
              skillPath: "~/.wave/skills/another-skill",
            },
          ]}
        />,
      );
      expect(lastFrame()).toContain("another-skill");
    });
  });
});
