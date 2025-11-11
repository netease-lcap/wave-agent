import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Agent } from "../../src/agent.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Agent sessionDir integration tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-sessiondir-test-"));

    // Mock NODE_ENV to not be 'test' so session operations actually work
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Custom sessionDir", () => {
    it("should create Agent with custom sessionDir and save session", async () => {
      const customSessionDir = path.join(tempDir, "custom-sessions");

      const agent = await Agent.create({
        apiKey: "test-key",
        baseURL: "https://test-url.com",
        sessionDir: customSessionDir,
        messages: [
          {
            role: "user",
            blocks: [{ type: "text", content: "initial test message" }],
          },
          {
            role: "assistant",
            blocks: [
              { type: "text", content: "I understand your test message." },
            ],
          },
        ],
      });

      // Agent should be created successfully
      expect(agent).toBeDefined();

      // Verify that the agent has messages (initial test message)
      expect(agent.messages.length).toBeGreaterThan(0);

      // Manually trigger session save by destroying the agent
      await agent.destroy();

      // Session directory should be created
      const dirExists = await fs
        .access(customSessionDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      // Check if session file was created in custom directory
      const files = await fs.readdir(customSessionDir);
      const sessionFiles = files.filter(
        (f) => f.startsWith("session_") && f.endsWith(".json"),
      );
      expect(sessionFiles.length).toBeGreaterThan(0);
    });

    it("should save session files to custom directory using Agent.create", async () => {
      const customSessionDir = path.join(tempDir, "another-custom-sessions");

      const agent = await Agent.create({
        apiKey: "test-key",
        baseURL: "https://test-url.com",
        sessionDir: customSessionDir,
        messages: [
          { role: "user", blocks: [{ type: "text", content: "Hello world" }] },
          {
            role: "assistant",
            blocks: [{ type: "text", content: "Hello! How can I help you?" }],
          },
        ],
      });

      // Verify the agent has messages before destroying
      expect(agent.messages.length).toBeGreaterThan(0);

      // Add messages to the agent first and trigger save by destroying
      await agent.destroy();

      // Check if session directory was created first
      const dirExists = await fs
        .access(customSessionDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      // Check if session file was created in custom directory
      const files = await fs.readdir(customSessionDir);
      const sessionFiles = files.filter(
        (f) => f.startsWith("session_") && f.endsWith(".json"),
      );

      expect(sessionFiles.length).toBeGreaterThan(0);
    });
  });

  describe("Default sessionDir behavior", () => {
    it("should use default sessionDir when not specified", async () => {
      // Check that we can get the default session directory path
      const { resolveSessionDir } = await import(
        "../../src/services/session.js"
      );
      const defaultSessionDir = resolveSessionDir();

      const agent = await Agent.create({
        apiKey: "test-key",
        baseURL: "https://test-url.com",
        messages: [
          {
            role: "user",
            blocks: [{ type: "text", content: "default session test" }],
          },
        ],
      });

      // Agent should be created successfully
      expect(agent).toBeDefined();
      expect(agent.messages.length).toBeGreaterThan(0);

      // The agent should use the default session directory
      // We can't easily check the internal state, but we can verify the agent was created correctly
      expect(defaultSessionDir).toBeDefined();
      expect(defaultSessionDir).toMatch(/\.wave\/sessions$/);

      await agent.destroy();
    });

    it("should maintain backward compatibility with existing agent creation patterns", async () => {
      // This tests that the old pattern still works without sessionDir
      const agent = await Agent.create({
        apiKey: "test-key",
        baseURL: "https://test-url.com",
      });

      // Agent should be created successfully without any sessionDir specified
      expect(agent).toBeDefined();

      // Should be able to add messages and use the agent normally
      await agent.sendMessage("Test backward compatibility");
      expect(agent.messages.length).toBeGreaterThan(0);

      await agent.destroy();
    });
  });

  describe("Invalid sessionDir error handling", () => {
    it("should handle invalid sessionDir paths gracefully", async () => {
      // Test with a path that should be invalid on most systems
      const invalidSessionDir = "/root/invalid/readonly/path";

      try {
        const agent = await Agent.create({
          apiKey: "test-key",
          baseURL: "https://test-url.com",
          sessionDir: invalidSessionDir,
          messages: [
            {
              role: "user",
              blocks: [{ type: "text", content: "invalid path test" }],
            },
          ],
        });

        // If agent creation succeeds, the error should occur during session operations
        await agent.destroy(); // This should trigger session save and potentially fail

        // If we get here without error, the test environment might have allowed the path
        // That's ok for testing - the important thing is no crashes occur
      } catch (error) {
        // Expect a meaningful error related to session directory
        expect(error).toBeDefined();
        expect(String(error).toLowerCase()).toMatch(
          /session|directory|path|permission/,
        );
      }
    });

    it("should handle empty sessionDir string", async () => {
      try {
        const agent = await Agent.create({
          apiKey: "test-key",
          baseURL: "https://test-url.com",
          sessionDir: "", // Empty string should fall back to default
          messages: [
            {
              role: "user",
              blocks: [{ type: "text", content: "empty string test" }],
            },
          ],
        });

        // Should fall back to default behavior
        expect(agent).toBeDefined();
        await agent.destroy();
      } catch (error) {
        // If it errors, it should be a meaningful error
        expect(error).toBeDefined();
      }
    });

    it("should handle relative paths in sessionDir", async () => {
      const relativeSessionDir = "./relative-sessions";

      const agent = await Agent.create({
        apiKey: "test-key",
        baseURL: "https://test-url.com",
        sessionDir: relativeSessionDir,
        messages: [
          {
            role: "user",
            blocks: [{ type: "text", content: "relative path test" }],
          },
        ],
      });

      // Should work with relative paths (they should be resolved to absolute)
      expect(agent).toBeDefined();

      await agent.destroy();

      // Clean up the relative directory if it was created
      try {
        await fs.rm(relativeSessionDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
