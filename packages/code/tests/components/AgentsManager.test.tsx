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
  AgentsManager,
  AgentsManagerProps,
} from "../../src/components/AgentsManager.js";
import type {
  BackgroundTask,
  SubagentConfiguration,
  SubagentInstance,
} from "wave-agent-sdk";

const mockDefinitions: SubagentConfiguration[] = [
  {
    name: "bash",
    description: "Runs bash commands in a shell",
    tools: ["Bash", "Read", "Write"],
    systemPrompt:
      "You are a bash automation subagent.\n\n## Responsibilities\n- Run shell commands\n- Report results",
    filePath: "/usr/local/lib/.wave/agents/bash.md",
    scope: "builtin",
    priority: 0,
  },
  {
    name: "explore",
    description: "Fast agent specialized in code exploration",
    model: "claude-sonnet-4-5",
    systemPrompt: "You are an exploration subagent.",
    filePath: "~/.wave/agents/explore.md",
    scope: "user",
    priority: 1,
  },
  {
    name: "my-agent",
    description: "Project-specific agent",
    tools: ["Grep"],
    systemPrompt: "You are a project agent.",
    filePath: ".wave/agents/my-agent.md",
    scope: "project",
    priority: 2,
  },
  {
    name: "my-plugin:helper",
    description: "Agent provided by a plugin",
    systemPrompt: "You are a plugin agent.",
    filePath: "/plugins/my-plugin/agents/helper.md",
    scope: "plugin",
    priority: 3,
    pluginRoot: "/plugins/my-plugin",
  },
];

const mockInstance = (
  overrides: Partial<SubagentInstance> = {},
): SubagentInstance =>
  ({
    subagentId: "sub-1",
    configuration: mockDefinitions[0],
    aiManager: {},
    messageManager: {},
    toolManager: {},
    permissionManager: {},
    backgroundTaskManager: {},
    status: "active",
    messages: [],
    usedTools: [],
    subagentType: "bash",
    description: "Running shell commands",
    ...overrides,
  }) as unknown as SubagentInstance;

const mockBackgroundTask = (
  overrides: Partial<BackgroundTask> = {},
): BackgroundTask =>
  ({
    id: "task-1",
    type: "subagent",
    status: "running",
    startTime: Date.now(),
    stdout: "",
    stderr: "",
    description: "Fork subagent investigating issue #123",
    ...overrides,
  }) as BackgroundTask;

describe("AgentsManager", () => {
  let mockOnCancel: Mock<() => void>;
  let defaultProps: AgentsManagerProps;

  beforeEach(() => {
    mockOnCancel = vi.fn<() => void>();
    defaultProps = {
      onCancel: mockOnCancel,
      agentDefinitions: mockDefinitions,
      activeSubagentInstances: [mockInstance()],
      backgroundTasks: [],
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list view", () => {
    it("should show header and hint", () => {
      const { lastFrame } = render(<AgentsManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("Agents");
      expect(output).toContain("Select an agent to view details");
    });

    it("should display definitions grouped by scope", () => {
      const { lastFrame } = render(<AgentsManager {...defaultProps} />);
      const output = lastFrame();

      // Scope group headers
      expect(output).toContain("Built-in agents");
      expect(output).toContain("User agents");
      expect(output).toContain("Project agents");
      expect(output).toContain("Plugin agents");

      // Agent names
      expect(output).toContain("bash");
      expect(output).toContain("explore");
      expect(output).toContain("my-agent");
      expect(output).toContain("my-plugin:helper");

      // Model shown where configured
      expect(output).toContain("claude-sonnet-4-5");
    });

    it("should display active subagents section", () => {
      const props = {
        ...defaultProps,
        activeSubagentInstances: [mockInstance()],
      };
      const { lastFrame } = render(<AgentsManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("ACTIVE SUBAGENTS");
      expect(output).toContain("bash");
      expect(output).toContain("running");
    });

    it("should display background fork subagents", () => {
      const props = {
        ...defaultProps,
        backgroundTasks: [mockBackgroundTask()],
      };
      const { lastFrame } = render(<AgentsManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("fork subagent");
      expect(output).toContain("Fork subagent investigating issue #123");
    });

    it("should dedupe instances that transitioned to background tasks", () => {
      // Instance with backgroundTaskId pointing at an existing background task
      const instance = mockInstance({
        backgroundTaskId: "task-1",
        status: "active",
      });
      const props = {
        ...defaultProps,
        activeSubagentInstances: [instance],
        backgroundTasks: [mockBackgroundTask({ subagentId: "sub-1" })],
      };
      const { lastFrame } = render(<AgentsManager {...props} />);
      const output = lastFrame();

      // Only one bash row should appear (either via instance or task, not both)
      expect(output).toContain("ACTIVE SUBAGENTS");
      expect(output).not.toContain("fork subagent");
    });

    it("should show navigation instructions", () => {
      const { lastFrame } = render(<AgentsManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("↑/↓ to select");
      expect(output).toContain("Enter to view details");
      expect(output).toContain("Esc to close");
    });

    it("should show empty state when no agents and no active subagents", () => {
      const props = {
        ...defaultProps,
        agentDefinitions: [],
        activeSubagentInstances: [],
        backgroundTasks: [],
      };
      const { lastFrame } = render(<AgentsManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("No agents available");
      expect(output).toContain("Press Escape to close");
      expect(output).not.toContain("No active subagents");
    });

    it("should show no-active hint when agents exist but none are running", () => {
      const props = {
        ...defaultProps,
        agentDefinitions: [mockDefinitions[0]],
        activeSubagentInstances: [],
        backgroundTasks: [],
      };
      const { lastFrame } = render(<AgentsManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("No active subagents");
    });
  });

  describe("navigation", () => {
    it("should change selection with arrow keys", async () => {
      const { lastFrame, stdin } = render(<AgentsManager {...defaultProps} />);

      // First selectable entry is bash (builtin, first scope)
      expect(lastFrame()).toContain("▶ 1. bash");

      // Move down past bash + explore + my-agent + helper (4 definitions)
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      // Fifth selectable entry is the active subagent (bash instance)
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ 5. bash"));
    });

    it("should clamp selection at the bottom", async () => {
      const { lastFrame, stdin } = render(<AgentsManager {...defaultProps} />);

      for (let i = 0; i < 10; i++) {
        stdin.write("\u001B[B");
      }
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ 5. bash"));
    });

    it("should enter detail view on Enter and go back on Escape", async () => {
      const { lastFrame, stdin } = render(<AgentsManager {...defaultProps} />);

      stdin.write("\r");
      await vi.waitFor(() => expect(lastFrame()).toContain("Agent: bash"));

      // Detail shows all fields
      const output = lastFrame();
      expect(output).toContain("Description:");
      expect(output).toContain("Scope:");
      expect(output).toContain("Tools:");
      expect(output).toContain("File:");
      expect(output).toContain("System Prompt:");
      expect(output).toContain("Esc or Enter to go back");

      // Back to list
      stdin.write("\u001B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Select an agent to view details"),
      );
    });

    it("should call onCancel on Escape in list view", async () => {
      const { stdin } = render(<AgentsManager {...defaultProps} />);

      stdin.write("\u001B");
      await vi.waitFor(() => expect(mockOnCancel).toHaveBeenCalled());
    });

    it("should ignore arrow keys in detail view", async () => {
      const { lastFrame, stdin } = render(<AgentsManager {...defaultProps} />);

      stdin.write("\r");
      await vi.waitFor(() => expect(lastFrame()).toContain("Agent: bash"));

      // Arrow down in detail must not change the selected entry
      stdin.write("\u001B[B");
      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("Agent: bash"));
      expect(lastFrame()).toContain("You are a bash automation subagent.");
    });

    it("should show detail of active subagent", async () => {
      const props = {
        ...defaultProps,
        // Only the active instance (no definitions selected first)
        agentDefinitions: [],
        activeSubagentInstances: [mockInstance()],
      };
      const { lastFrame, stdin } = render(<AgentsManager {...props} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Active Subagent Details"),
      );
      const output = lastFrame();
      expect(output).toContain("Running shell commands");
      expect(output).toContain("Status:");
      expect(output).toContain("running");
    });
  });

  describe("detail view content", () => {
    it("should render full system prompt markdown without truncation", async () => {
      const props = {
        ...defaultProps,
        agentDefinitions: [
          {
            ...mockDefinitions[0],
            systemPrompt:
              "# Long Agent\n\nThis is a **very long** system prompt.\n\n## Section\n\n- bullet one\n- bullet two\n\n```js\nconsole.log(1);\n```\n\nParagraph with `inline code`.",
          },
        ],
        activeSubagentInstances: [],
        backgroundTasks: [],
      };
      const { lastFrame, stdin } = render(<AgentsManager {...props} />);

      stdin.write("\r");
      await vi.waitFor(() => expect(lastFrame()).toContain("Agent: bash"));
      const output = lastFrame();

      // Full content rendered — headings, bold, lists, code fences, inline code
      expect(output).toContain("# Long Agent");
      expect(output).toContain("very long");
      expect(output).toContain("bullet one");
      expect(output).toContain("bullet two");
      expect(output).toContain("```");
      expect(output).toContain("console.log(1);");
      expect(output).toContain("inline code");
    });

    it("should show default model label when no model configured", async () => {
      const props = {
        ...defaultProps,
        agentDefinitions: [mockDefinitions[0]], // bash has no model
        activeSubagentInstances: [],
        backgroundTasks: [],
      };
      const { lastFrame, stdin } = render(<AgentsManager {...props} />);

      stdin.write("\r");
      await vi.waitFor(() => expect(lastFrame()).toContain("Agent: bash"));
      expect(lastFrame()).toContain("default (not explicitly configured)");
    });
  });

  describe("component lifecycle", () => {
    it("should cleanup properly on unmount", () => {
      const { unmount } = render(<AgentsManager {...defaultProps} />);

      expect(() => unmount()).not.toThrow();
    });

    it("should handle prop changes (live background task updates)", () => {
      const { rerender, lastFrame } = render(
        <AgentsManager {...defaultProps} />,
      );

      // A new fork subagent starts
      rerender(
        <AgentsManager
          {...defaultProps}
          backgroundTasks={[mockBackgroundTask()]}
        />,
      );
      const output = lastFrame();
      expect(output).toContain("fork subagent");
    });
  });
});
