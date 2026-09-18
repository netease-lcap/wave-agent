import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../src/agent.js";
import { PluginLoader } from "../src/services/pluginLoader.js";
import { AIManager } from "../src/managers/aiManager.js";
import { CustomSlashCommand, TextBlock } from "../src/types/index.js";
import { cleanupMetaOnlySessions } from "../src/services/session.js";
import * as fs from "fs/promises";
import * as os from "os";
import { exec } from "child_process";

vi.mock("fs/promises");
vi.mock("child_process");
vi.mock("../src/services/session.js");
vi.mock("../src/managers/aiManager.js");
vi.mock("../src/managers/mcpManager.js");
vi.mock("../src/managers/skillManager.js");

import { SkillManager } from "../src/managers/skillManager.js";

describe("Agent Plugin Integration", () => {
  const workdir = "/test/workdir";
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cleanupMetaOnlySessions).mockResolvedValue(0);
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(os.homedir).mockReturnValue("/home/user");

    // Mock SkillManager.getAvailableSkills to return empty array
    vi.mocked(SkillManager.prototype.getAvailableSkills).mockReturnValue([]);

    // Mock exec for SlashCommandManager
    vi.mocked(exec).mockImplementation((_cmd, options, callback) => {
      const mockResult = { stdout: "mock output", stderr: "" };
      if (typeof options === "function") {
        (
          options as (
            error: Error | null,
            stdout: unknown,
            stderr: string,
          ) => void
        )(null, mockResult, "");
      } else if (callback) {
        callback(null, mockResult as unknown as string, "");
      }
      return {} as unknown as ReturnType<typeof exec>;
    });

    // Spy on PluginLoader
    vi.spyOn(PluginLoader, "loadManifest").mockImplementation(async () => ({
      name: "test-plugin",
      description: "A test plugin",
      version: "1.0.0",
    }));
    vi.spyOn(PluginLoader, "loadCommands").mockImplementation(() => []);
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("should load plugins from AgentOptions and register commands", async () => {
    const mockManifest = {
      name: "test-plugin",
      description: "A test plugin",
      version: "1.0.0",
    };
    const mockCommands = [
      {
        id: "hello",
        name: "hello",
        description: "Say hello",
        filePath: "/test/workdir/plugins/test-plugin/commands/hello.md",
        content: "Hello world",
      },
    ];

    vi.spyOn(PluginLoader, "loadManifest").mockResolvedValue(mockManifest);
    vi.spyOn(PluginLoader, "loadCommands").mockReturnValue(
      mockCommands as unknown as CustomSlashCommand[],
    );

    const agent = await Agent.create({
      workdir,
      plugins: [
        {
          type: "local",
          path: "plugins/test-plugin",
        },
      ],
    });
    activeAgent = agent;

    const commands = agent.getSlashCommands();
    // Plugin commands are namespaced as pluginName:commandId
    const pluginCommand = commands.find((c) => c.id === "test-plugin:hello");
    expect(pluginCommand).toBeDefined();
    expect(pluginCommand?.name).toBe("test-plugin:hello");
    expect(pluginCommand?.description).toBe("Say hello");
  });

  it("should execute plugin commands via sendMessage", async () => {
    const mockManifest = {
      name: "test-plugin",
      description: "A test plugin",
      version: "1.0.0",
    };
    const mockCommands = [
      {
        id: "hello",
        name: "hello",
        description: "Say hello",
        filePath: "/test/workdir/plugins/test-plugin/commands/hello.md",
        content: "Hello world",
      },
    ];

    vi.spyOn(PluginLoader, "loadManifest").mockResolvedValue(mockManifest);
    vi.spyOn(PluginLoader, "loadCommands").mockReturnValue(
      mockCommands as unknown as CustomSlashCommand[],
    );

    const agent = await Agent.create({
      workdir,
      plugins: [
        {
          type: "local",
          path: "plugins/test-plugin",
        },
      ],
    });
    activeAgent = agent;

    // Mock AIManager.sendAIMessage
    const aiManager = vi.mocked(AIManager).mock.instances[0];
    const sendAIMessageSpy = vi
      .spyOn(aiManager, "sendAIMessage")
      .mockResolvedValue(undefined);

    // Execute the plugin command
    await agent.sendMessage("/test-plugin:hello");

    // Verify that the command was parsed and executed
    // SlashCommandManager.executeCustomCommandInMainAgent should have been called
    // which adds a user message and calls aiManager.sendAIMessage
    expect(sendAIMessageSpy).toHaveBeenCalled();

    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    const textBlock = lastMessage.blocks[0] as TextBlock;
    expect(textBlock.customCommandContent).toBe("Hello world");
  });

  it("should handle plugin commands with parameters", async () => {
    const mockManifest = {
      name: "test-plugin",
      description: "A test plugin",
      version: "1.0.0",
    };
    const mockCommands = [
      {
        id: "greet",
        name: "greet",
        description: "Greet someone",
        filePath: "/test/workdir/plugins/test-plugin/commands/greet.md",
        content: "Hello $ARGUMENTS!",
      },
    ];

    vi.spyOn(PluginLoader, "loadManifest").mockResolvedValue(mockManifest);
    vi.spyOn(PluginLoader, "loadCommands").mockReturnValue(
      mockCommands as unknown as CustomSlashCommand[],
    );

    const agent = await Agent.create({
      workdir,
      plugins: [
        {
          type: "local",
          path: "plugins/test-plugin",
        },
      ],
    });
    activeAgent = agent;

    const aiManager = vi.mocked(AIManager).mock.instances[0];
    vi.spyOn(aiManager, "sendAIMessage").mockResolvedValue(undefined);

    await agent.sendMessage("/test-plugin:greet World");

    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    const textBlock = lastMessage.blocks[0] as TextBlock;
    expect(textBlock.customCommandContent).toBe("Hello World!");
  });

  // 插件变更的就地重载（docs/specs/ecosystem/plugin.md「插件变更的就地重载」
  // 场景 2 / 3）：同一个会话里换装，会话 id 不变，卸载掉的能力随之消失。
  it("should swap plugin capabilities in place without touching the session", async () => {
    const mockManifest = {
      name: "test-plugin",
      description: "A test plugin",
      version: "1.0.0",
    };
    vi.spyOn(PluginLoader, "loadManifest").mockResolvedValue(mockManifest);
    vi.spyOn(PluginLoader, "loadCommands").mockReturnValue([
      {
        id: "hello",
        name: "hello",
        description: "Say hello",
        filePath: "/test/workdir/plugins/test-plugin/commands/hello.md",
        content: "Hello world",
      },
    ] as unknown as CustomSlashCommand[]);

    const agent = await Agent.create({
      workdir,
      plugins: [{ type: "local", path: "plugins/test-plugin" }],
    });
    activeAgent = agent;
    const sessionId = agent.sessionId;
    const messagesBefore = agent.messages.length;
    expect(
      agent.getSlashCommands().some((c) => c.id === "test-plugin:hello"),
    ).toBe(true);

    // 磁盘上该插件已卸载（命令消失），同时多出一个技能命令。
    vi.spyOn(PluginLoader, "loadCommands").mockReturnValue([]);
    vi.mocked(SkillManager.prototype.getAvailableSkills).mockReturnValue([
      {
        name: "test-plugin:new-skill",
        description: "A plugin skill",
        type: "plugin",
        skillPath: "/test/workdir/plugins/test-plugin/skills/new-skill",
        pluginName: "test-plugin",
      },
    ] as unknown as ReturnType<
      typeof SkillManager.prototype.getAvailableSkills
    >);

    const result = await agent.reloadPlugins();

    expect(result.failures).toEqual([]);
    expect(result.plugins).toContain("test-plugin");
    // 就地：会话未重建、消息未清空。
    expect(agent.sessionId).toBe(sessionId);
    expect(agent.messages.length).toBe(messagesBefore);
    const commands = agent.getSlashCommands();
    expect(commands.some((c) => c.id === "test-plugin:hello")).toBe(false);
    // 插件技能带来的斜杠命令在重载时重新派生。
    expect(commands.some((c) => c.id === "test-plugin:new-skill")).toBe(true);
  });
});
