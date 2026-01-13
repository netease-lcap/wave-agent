import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import { PluginLoader } from "../src/services/pluginLoader.js";
import { AIManager } from "../src/managers/aiManager.js";
import { CustomSlashCommand } from "../src/types/index.js";
import * as fs from "fs/promises";
import * as os from "os";
import { exec } from "child_process";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue("/home/user"),
    platform: vi.fn().mockReturnValue("linux"),
    default: {
      ...actual,
      homedir: vi.fn().mockReturnValue("/home/user"),
      platform: vi.fn().mockReturnValue("linux"),
    },
  };
});
vi.mock("fs/promises");
vi.mock("child_process");
vi.mock("../src/services/session.js");
vi.mock("../src/managers/aiManager.js");
vi.mock("../src/managers/mcpManager.js");
vi.mock("../src/managers/skillManager.js");

import { SkillManager } from "../src/managers/skillManager.js";
import { TextBlock } from "../src/types/index.js";

describe("Agent Plugin Integration", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
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

    // Mock AIManager.sendAIMessage
    const aiManager = vi.mocked(AIManager).mock.instances[0];
    const sendAIMessageSpy = vi
      .spyOn(aiManager, "sendAIMessage")
      .mockResolvedValue(undefined);

    // Execute the plugin command
    await agent.sendMessage("/test-plugin:hello");

    // Verify that the command was parsed and executed
    // SlashCommandManager.executeCustomCommandInMainAgent should have been called
    // which adds a message and calls aiManager.sendAIMessage
    expect(sendAIMessageSpy).toHaveBeenCalled();

    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    const textBlock = lastMessage.blocks[0] as TextBlock;
    expect(textBlock.content).toBe("/test-plugin:hello");
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

    const aiManager = vi.mocked(AIManager).mock.instances[0];
    vi.spyOn(aiManager, "sendAIMessage").mockResolvedValue(undefined);

    await agent.sendMessage("/test-plugin:greet World");

    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    const textBlock = lastMessage.blocks[0] as TextBlock;
    expect(textBlock.content).toBe("/test-plugin:greet World");
    expect(textBlock.customCommandContent).toBe("Hello World!");
  });
});
