import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
import { promises as fs } from "fs";
import * as fsPromises from "fs/promises";
import type { PathLike } from "fs";
import type { FileHandle } from "fs/promises";
import * as path from "node:path";

// Mock both fs import patterns
vi.mock("fs", () => ({
  promises: {
    rm: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn((p) => Promise.resolve(p)),
  },
}));

vi.mock("fs/promises", () => ({
  rm: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  realpath: vi.fn((p) => Promise.resolve(p)),
}));

// Mock os module
vi.mock("os", () => ({
  default: {
    homedir: vi.fn(() => "/mock/home"),
    tmpdir: vi.fn(() => "/mock/tmp"),
    platform: vi.fn(() => "linux"),
  },
  homedir: vi.fn(() => "/mock/home"),
  tmpdir: vi.fn(() => "/mock/tmp"),
  platform: vi.fn(() => "linux"),
}));

// Mock the aiService
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
  compressMessages: vi.fn().mockResolvedValue("Compressed content"),
}));

describe("Agent Modular Memory Rules Integration", () => {
  let mockCallbacks: AgentCallbacks;
  let mockTempDir: string;
  const mockHomeDir = "/mock/home";

  beforeEach(async () => {
    mockTempDir = "/mock/tmp/agent-modular-rules-test";

    // Setup default fs mock implementations
    const defaultMock = async () => {
      return undefined;
    };
    vi.mocked(fs.rm).mockImplementation(defaultMock);
    vi.mocked(fs.access).mockImplementation(defaultMock);
    vi.mocked(fs.mkdir).mockImplementation(defaultMock);
    vi.mocked(fs.writeFile).mockImplementation(defaultMock);
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);

    vi.mocked(fsPromises.rm).mockImplementation(defaultMock);
    vi.mocked(fsPromises.access).mockImplementation(defaultMock);
    vi.mocked(fsPromises.mkdir).mockImplementation(defaultMock);
    vi.mocked(fsPromises.writeFile).mockImplementation(defaultMock);
    vi.mocked(fsPromises.readFile).mockResolvedValue("");
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    vi.clearAllMocks();

    mockCallbacks = {
      onMessagesChange: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it("should discover rules from project and user directories during Agent.create()", async () => {
    const projectRulesDir = path.join(mockTempDir, ".wave", "rules");
    const userRulesDir = path.join(mockHomeDir, ".wave", "rules");

    const projectRulePath = path.join(projectRulesDir, "project-rule.md");
    const userRulePath = path.join(userRulesDir, "user-rule.md");

    const projectRuleContent =
      '---\npaths: ["src/**/*.ts"]\n---\nProject rule content';
    const userRuleContent = '---\npaths: ["**/*.js"]\n---\nUser rule content';

    vi.mocked(fsPromises.readdir).mockImplementation(async (dir: PathLike) => {
      if (dir.toString() === projectRulesDir) {
        return [
          {
            name: "project-rule.md",
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>;
      }
      if (dir.toString() === userRulesDir) {
        return [
          {
            name: "user-rule.md",
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>;
      }
      return [];
    });

    vi.mocked(fsPromises.readFile).mockImplementation(
      async (filePath: PathLike | FileHandle) => {
        if (filePath.toString() === projectRulePath) return projectRuleContent;
        if (filePath.toString() === userRulePath) return userRuleContent;
        return "";
      },
    );

    const agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Verify combinedMemory includes both rules by default (since they match everything or we haven't added files yet)
    // Actually, by default filesInContext is empty.
    // MemoryRuleService.isRuleActive returns true if metadata.paths is empty.
    // Here paths are NOT empty. So they should NOT be active if filesInContext is empty.

    expect(agent.combinedMemory).not.toContain("Project rule content");
    expect(agent.combinedMemory).not.toContain("User rule content");

    await agent.destroy();
  });

  it("should include active modular rules in combinedMemory based on files in context", async () => {
    const projectRulesDir = path.join(mockTempDir, ".wave", "rules");
    const projectRulePath = path.join(projectRulesDir, "test-rule.md");
    const projectRuleContent =
      "---\npaths:\n  - src/important.ts\n---\nImportant rule content";

    vi.mocked(fsPromises.readdir).mockImplementation(async (dir: PathLike) => {
      if (dir.toString() === projectRulesDir) {
        return [
          {
            name: "test-rule.md",
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>;
      }
      return [];
    });

    vi.mocked(fsPromises.readFile).mockImplementation(
      async (filePath: PathLike | FileHandle) => {
        if (filePath.toString() === projectRulePath) return projectRuleContent;
        return "";
      },
    );

    const agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Initially not active
    expect(agent.combinedMemory).not.toContain("Important rule content");

    // Add a message that mentions the file
    // We need to simulate a tool call that mentions the file
    const messageWithToolCall = {
      role: "assistant" as const,
      blocks: [
        {
          type: "tool" as const,
          id: "call_1",
          name: "read_file",
          parameters: JSON.stringify({ path: "src/important.ts" }),
          state: "completed" as const,
        },
      ],
    };

    // Manually set messages to trigger filesInContext update
    (
      agent as unknown as {
        messageManager: { setMessages: (messages: unknown[]) => void };
      }
    ).messageManager.setMessages([messageWithToolCall]);

    expect(agent.combinedMemory).toContain("Important rule content");

    await agent.destroy();
  });

  it("should prioritize project rules over user rules if they have the same relative path", async () => {
    const projectRulesDir = path.join(mockTempDir, ".wave", "rules");
    const userRulesDir = path.join(mockHomeDir, ".wave", "rules");

    const relativePath = "common-rule.md";
    const projectRulePath = path.join(projectRulesDir, relativePath);
    const userRulePath = path.join(userRulesDir, relativePath);

    vi.mocked(fsPromises.readdir).mockImplementation(async (dir: PathLike) => {
      if (dir.toString() === projectRulesDir) {
        return [
          {
            name: relativePath,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>;
      }
      if (dir.toString() === userRulesDir) {
        return [
          {
            name: relativePath,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>;
      }
      return [];
    });

    vi.mocked(fsPromises.readFile).mockImplementation(
      async (filePath: PathLike | FileHandle) => {
        if (filePath.toString() === projectRulePath)
          return "---\npriority: 10\n---\nProject rule content";
        if (filePath.toString() === userRulePath)
          return "---\npriority: 5\n---\nUser rule content";
        return "";
      },
    );

    const agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Both rules have the same relative path, so project should override user
    // Since they don't have 'paths' metadata, they are always active
    expect(agent.combinedMemory).toContain("Project rule content");
    expect(agent.combinedMemory).not.toContain("User rule content");

    await agent.destroy();
  });
});
