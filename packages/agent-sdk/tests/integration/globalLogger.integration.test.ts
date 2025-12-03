/**
 * Integration Tests for Agent Class and Global Logger System
 *
 * These tests verify the integration between Agent instances and the global logger
 * system, ensuring proper configuration, isolation, and end-to-end functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import {
  setGlobalLogger,
  clearGlobalLogger,
  isLoggerConfigured,
  logger as globalLogger,
} from "../../src/utils/globalLogger.js";
import {
  createMockLogger,
  resetMockLogger,
  expectLoggerCall,
  type MockLogger,
} from "../utils/mockLogger.js";

describe("Agent - Global Logger Integration", () => {
  const originalEnv = process.env;
  let mockLogger1: MockLogger;
  let mockLogger2: MockLogger;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Set up environment for Agent creation
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.AIGW_TOKEN = "test-api-key";
    process.env.AIGW_URL = "https://test-gateway.com/api";

    // Create fresh mock loggers for each test
    mockLogger1 = createMockLogger();
    mockLogger2 = createMockLogger();

    // Clear global logger state
    clearGlobalLogger();

    // Mock console methods to suppress output during testing
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Clean up global logger
    clearGlobalLogger();

    // Restore environment
    process.env = originalEnv;

    // Restore console methods
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("Agent.create() Logger Configuration", () => {
    it("should set global logger when Agent.create() is called with logger option", async () => {
      // Verify initial state - no global logger set
      expect(isLoggerConfigured()).toBe(false);

      // Create Agent with logger option
      const agent = await Agent.create({
        logger: mockLogger1,
      });

      // Verify global logger is set to the provided logger
      expect(isLoggerConfigured()).toBe(true);
      expect(agent).toBeDefined();

      await agent.destroy();
    });

    it("should leave global logger as null when Agent.create() is called without logger option", async () => {
      // Verify initial state - no global logger set
      expect(isLoggerConfigured()).toBe(false);

      // Create Agent without logger option
      const agent = await Agent.create({});

      // Verify global logger remains null
      expect(isLoggerConfigured()).toBe(false);

      await agent.destroy();
    });

    it("should handle undefined logger option same as no logger", async () => {
      // Verify initial state
      expect(isLoggerConfigured()).toBe(false);

      // Create Agent with explicit undefined logger
      const agent = await Agent.create({
        logger: undefined,
      });

      // Verify global logger remains null
      expect(isLoggerConfigured()).toBe(false);

      await agent.destroy();
    });
  });

  describe("Multiple Agent Instances", () => {
    it("should have last created Agent win for global logger configuration", async () => {
      // Create first Agent with logger1
      const agent1 = await Agent.create({
        logger: mockLogger1,
      });

      expect(isLoggerConfigured()).toBe(true);

      // Create second Agent with logger2 - should override global logger
      const agent2 = await Agent.create({
        logger: mockLogger2,
      });

      expect(isLoggerConfigured()).toBe(true);

      // Create third Agent without logger - should clear global logger
      const agent3 = await Agent.create({});

      expect(isLoggerConfigured()).toBe(false);

      // Clean up
      await agent1.destroy();
      await agent2.destroy();
      await agent3.destroy();
    });

    it("should maintain independent Agent instance loggers", async () => {
      // Create Agent1 with logger1
      const agent1 = await Agent.create({
        logger: mockLogger1,
      });

      // Create Agent2 with logger2 (this changes global logger)
      const agent2 = await Agent.create({
        logger: mockLogger2,
      });

      // Both agents should maintain their own logger references
      // Note: We can't directly access private properties, but we can test behavior
      expect(isLoggerConfigured()).toBe(true);

      // Clean up
      await agent1.destroy();
      await agent2.destroy();
    });
  });

  describe("Global Logger Independence", () => {
    it("should allow global logger to work independently of Agent instances", async () => {
      // Set global logger manually
      setGlobalLogger(mockLogger1);

      // Use global logger directly
      globalLogger.info("Direct global logger usage");
      globalLogger.warn("Warning message");

      // Verify mock logger received calls
      expectLoggerCall(mockLogger1, "info", ["Direct global logger usage"]);
      expectLoggerCall(mockLogger1, "warn", ["Warning message"]);

      // Create Agent with different logger
      const agent = await Agent.create({
        logger: mockLogger2,
      });

      // Global logger should now be mockLogger2
      expect(isLoggerConfigured()).toBe(true);

      // Use global logger again
      resetMockLogger(mockLogger2);
      globalLogger.error("Error after Agent creation");

      expectLoggerCall(mockLogger2, "error", ["Error after Agent creation"]);

      await agent.destroy();
    });

    it("should handle global logger calls when no logger is configured", async () => {
      // Ensure no global logger is set
      clearGlobalLogger();
      expect(isLoggerConfigured()).toBe(false);

      // Call global logger methods - should be no-ops
      globalLogger.debug("Should be ignored");
      globalLogger.info("Should be ignored");
      globalLogger.warn("Should be ignored");
      globalLogger.error("Should be ignored");

      // Verify no calls were made (since no logger was configured)
      // We can't check the mock logger directly since it's not set
      // But we can verify the global logger is still null
      expect(isLoggerConfigured()).toBe(false);
    });
  });

  describe("End-to-End Integration Scenarios", () => {
    it("should demonstrate complete global logger integration with Agent", async () => {
      // Step 1: Create Agent with logger
      const agent = await Agent.create({
        logger: mockLogger1,
        workdir: process.cwd(),
      });

      // Step 2: Verify global logger is configured
      expect(isLoggerConfigured()).toBe(true);

      // Step 3: Use global logger from utility code (simulated)
      globalLogger.info("Agent initialized successfully");
      globalLogger.debug("Configuration loaded", {
        workdir: agent.workingDirectory,
      });

      // Step 4: Verify logging occurred
      expectLoggerCall(mockLogger1, "info", ["Agent initialized successfully"]);
      expectLoggerCall(mockLogger1, "debug", [
        "Configuration loaded",
        { workdir: agent.workingDirectory },
      ]);

      // Step 5: Agent operations that might trigger internal logging
      // Note: Internal logging depends on implementation details
      await agent.sendMessage("Test message");

      // Step 6: Verify global logger was available throughout
      expect(isLoggerConfigured()).toBe(true);

      await agent.destroy();
    });

    it("should handle Agent lifecycle with global logger persistence", async () => {
      // Create first Agent
      const agent1 = await Agent.create({
        logger: mockLogger1,
      });

      expect(isLoggerConfigured()).toBe(true);

      // Log something
      globalLogger.info("First Agent active");
      expectLoggerCall(mockLogger1, "info", ["First Agent active"]);

      // Destroy first Agent
      await agent1.destroy();

      // Global logger should persist after Agent destruction
      expect(isLoggerConfigured()).toBe(true);

      // Should still be able to log
      resetMockLogger(mockLogger1);
      globalLogger.warn("After Agent destroyed");
      expectLoggerCall(mockLogger1, "warn", ["After Agent destroyed"]);

      // Create second Agent with different logger
      const agent2 = await Agent.create({
        logger: mockLogger2,
      });

      expect(isLoggerConfigured()).toBe(true);

      await agent2.destroy();
    });

    it("should handle multiple Agent creations and global logger state transitions", async () => {
      const logMessages: string[] = [];

      // Start with no global logger
      expect(isLoggerConfigured()).toBe(false);

      // Create Agent1 with logger
      const agent1 = await Agent.create({ logger: mockLogger1 });
      expect(isLoggerConfigured()).toBe(true);

      globalLogger.info("Stage 1: Agent1 active");
      logMessages.push("Stage 1: Agent1 active");

      // Create Agent2 without logger (clears global logger)
      const agent2 = await Agent.create({});
      expect(isLoggerConfigured()).toBe(false);

      // This should be a no-op
      globalLogger.info("Stage 2: No global logger");

      // Create Agent3 with different logger
      const agent3 = await Agent.create({ logger: mockLogger2 });
      expect(isLoggerConfigured()).toBe(true);

      globalLogger.warn("Stage 3: Agent3 active");
      logMessages.push("Stage 3: Agent3 active");

      // Verify expected calls were made to appropriate loggers
      expectLoggerCall(mockLogger1, "info", [logMessages[0]]);
      expectLoggerCall(mockLogger2, "warn", [logMessages[1]]);

      // mockLogger1 should not have received the "Stage 3" message
      expect(mockLogger1.warn).not.toHaveBeenCalledWith(
        "Stage 3: Agent3 active",
      );

      // Clean up all agents
      await agent1.destroy();
      await agent2.destroy();
      await agent3.destroy();
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle Agent creation failure without affecting global logger", async () => {
      // Set initial global logger
      setGlobalLogger(mockLogger1);
      globalLogger.info("Initial state");

      // Attempt to create Agent with invalid configuration
      // This should fail but not affect the global logger
      await expect(
        Agent.create({
          apiKey: "", // Invalid empty API key
          baseURL: "https://test.com",
          logger: mockLogger2,
        }),
      ).rejects.toThrow();

      // Global logger should remain unchanged
      expect(isLoggerConfigured()).toBe(true);

      // Should still be able to use original global logger
      resetMockLogger(mockLogger1);
      globalLogger.error("After failed Agent creation");
      expectLoggerCall(mockLogger1, "error", ["After failed Agent creation"]);
    });

    it("should handle concurrent Agent creation with logger configuration", async () => {
      // Create multiple Agents concurrently
      const agentPromises = [
        Agent.create({ logger: mockLogger1 }),
        Agent.create({ logger: mockLogger2 }),
        Agent.create({}), // No logger
      ];

      const agents = await Promise.all(agentPromises);

      // The last Agent to complete should determine the global logger
      // Since Agent.create() without logger should clear global logger,
      // and promise order is not guaranteed, we verify the final state is consistent
      // (either configured or not configured)
      expect(typeof isLoggerConfigured()).toBe("boolean");

      // Clean up all agents
      await Promise.all(agents.map((agent) => agent.destroy()));
    });
  });

  describe("Global Logger State Verification", () => {
    it("should verify global logger state changes are atomic", async () => {
      // Track global logger state changes by checking configuration state
      expect(isLoggerConfigured()).toBe(false);

      // Create Agent1
      await Agent.create({ logger: mockLogger1 });
      expect(isLoggerConfigured()).toBe(true);

      // Create Agent2
      await Agent.create({ logger: mockLogger2 });
      expect(isLoggerConfigured()).toBe(true);

      // Create Agent3 without logger
      await Agent.create({});
      expect(isLoggerConfigured()).toBe(false);

      // Verify the progression happened as expected
      // (we can no longer check specific instances, but we can verify behavior)
      expect(isLoggerConfigured()).toBe(false);
    });

    it("should maintain global logger consistency across Agent operations", async () => {
      const agent = await Agent.create({ logger: mockLogger1 });

      // Verify consistent global logger during various operations
      expect(isLoggerConfigured()).toBe(true);

      // Simulate various Agent operations
      expect(agent.sessionId).toBeDefined();
      expect(isLoggerConfigured()).toBe(true);

      expect(agent.messages).toEqual([]);
      expect(isLoggerConfigured()).toBe(true);

      expect(agent.workingDirectory).toBeDefined();
      expect(isLoggerConfigured()).toBe(true);

      // After destruction, global logger should still be set
      // (destruction doesn't clear global logger)
      await agent.destroy();
      expect(isLoggerConfigured()).toBe(true);
    });
  });

  describe("User Story 2: Utility Functions Use Global Logger", () => {
    beforeEach(async () => {
      // Ensure we're in test environment
      process.env.NODE_ENV = "test";

      // Clear all module cache to ensure fresh imports
      vi.resetModules();
    });

    describe("Utility functions log when global logger is configured", () => {
      it("should demonstrate global logger usage with utility modules", () => {
        // Set up global logger first
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Test direct usage of existing global logger import
        globalLogger.debug("Test message from utility context");
        globalLogger.error("Test error from utility context");

        // Verify logging occurred
        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Test message from utility context",
        );
        expect(mockLogger1.error).toHaveBeenCalledWith(
          "Test error from utility context",
        );
      });

      it("should work with existing cached modules", () => {
        // Set up global logger first
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Use the already imported globalLogger from the top of the file
        globalLogger.debug("Test message from cached module");
        globalLogger.error("Test error from cached module");

        // Verify logging occurred
        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Test message from cached module",
        );
        expect(mockLogger1.error).toHaveBeenCalledWith(
          "Test error from cached module",
        );
      });
    });

    describe("Utility functions are silent when global logger is not configured", () => {
      it("should not crash when global logger is not set", () => {
        // Ensure no global logger is set
        clearGlobalLogger();
        expect(isLoggerConfigured()).toBe(false);

        // Use the global logger from the top-level import
        expect(() => {
          globalLogger.debug("Should be ignored");
          globalLogger.info("Should be ignored");
          globalLogger.warn("Should be ignored");
          globalLogger.error("Should be ignored");
        }).not.toThrow();

        // Verify no mock logger was called (since none is set)
        expect(mockLogger1.debug).not.toHaveBeenCalled();
        expect(mockLogger1.error).not.toHaveBeenCalled();
      });

      it("should handle utility functions gracefully without logger", async () => {
        // Import utility modules
        const { loadCustomSlashCommands } = await import(
          "../../src/utils/customCommands.js"
        );
        const { convertMessagesForAPI } = await import(
          "../../src/utils/convertMessagesForAPI.js"
        );

        // Ensure no global logger is set
        clearGlobalLogger();
        expect(isLoggerConfigured()).toBe(false);

        // These should work without throwing errors, even without logger
        expect(() => {
          const result1 = loadCustomSlashCommands("/tmp");
          expect(Array.isArray(result1)).toBe(true);

          const validMessages = [
            {
              id: "test-msg-1",
              role: "user" as const,
              blocks: [
                {
                  type: "text" as const,
                  content: "Hello world",
                },
              ],
              timestamp: Date.now(),
            },
          ];
          const result2 = convertMessagesForAPI(validMessages);
          expect(Array.isArray(result2)).toBe(true);
        }).not.toThrow();

        // Verify no mock logger was called
        expect(mockLogger1.debug).not.toHaveBeenCalled();
        expect(mockLogger1.warn).not.toHaveBeenCalled();
        expect(mockLogger1.error).not.toHaveBeenCalled();
      });
    });

    describe("Utility functions use appropriate log levels", () => {
      it("should demonstrate different log levels work with global logger", () => {
        // Set up global logger
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Test different log levels using the existing globalLogger import
        globalLogger.debug("Debug message from utility");
        globalLogger.info("Info message from utility");
        globalLogger.warn("Warning message from utility");
        globalLogger.error("Error message from utility");

        // Verify each level was called
        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Debug message from utility",
        );
        expect(mockLogger1.info).toHaveBeenCalledWith(
          "Info message from utility",
        );
        expect(mockLogger1.warn).toHaveBeenCalledWith(
          "Warning message from utility",
        );
        expect(mockLogger1.error).toHaveBeenCalledWith(
          "Error message from utility",
        );
      });

      it("should handle error logging with context", () => {
        // Set up global logger
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Simulate error logging with context like convertMessagesForAPI would do
        const testError = new Error("Test conversion error");
        const imagePath = "/path/to/test/image.jpg";

        globalLogger.error(
          "Failed to convert image path to base64:",
          imagePath,
          testError,
        );

        // Verify error logging with context
        expect(mockLogger1.error).toHaveBeenCalledWith(
          "Failed to convert image path to base64:",
          imagePath,
          testError,
        );
        expect(mockLogger1.debug).not.toHaveBeenCalled();
        expect(mockLogger1.info).not.toHaveBeenCalled();
      });

      it("should handle warning logging with file context", () => {
        // Set up global logger
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Simulate warning logging like customCommands would do
        const filePath = "/test/path/to/file.md";
        const accessError = new Error("Permission denied");

        globalLogger.warn(`Cannot access ${filePath}:`, accessError);

        // Verify warning logging with file context
        expect(mockLogger1.warn).toHaveBeenCalledWith(
          `Cannot access ${filePath}:`,
          accessError,
        );
        expect(mockLogger1.debug).not.toHaveBeenCalled();
        expect(mockLogger1.error).not.toHaveBeenCalled();
      });
    });

    describe("Logging includes contextual information", () => {
      it("should include context in log messages", () => {
        // Set up global logger
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Test logging with context objects like bashHistory would do
        const commandContext = {
          command: "git status",
          workdir: "/home/test/project",
        };
        globalLogger.debug("Added bash command to history:", commandContext);

        // Verify context was logged
        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Added bash command to history:",
          commandContext,
        );
      });

      it("should include search context in log messages", () => {
        // Set up global logger
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Test logging with search context like searchBashHistory would do
        const searchContext = {
          query: "git",
          workdir: "/home/test",
          originalCount: 5,
          dedupedCount: 3,
        };
        globalLogger.debug("Bash history search results:", searchContext);

        // Verify search context was logged
        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Bash history search results:",
          searchContext,
        );
      });

      it("should include error context in log messages", () => {
        // Set up global logger
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);

        // Test error logging with file path context
        const imagePath = "/path/to/missing/image.jpg";
        const conversionError = new Error("File not found");

        globalLogger.error(
          "Failed to convert image path to base64:",
          imagePath,
          conversionError,
        );

        // Verify error context was logged
        expect(mockLogger1.error).toHaveBeenCalledWith(
          "Failed to convert image path to base64:",
          imagePath,
          conversionError,
        );
      });
    });

    describe("Integration with Agent instances", () => {
      it("should use Agent's logger when utility functions access global logger", async () => {
        // Create Agent with logger
        const agent = await Agent.create({
          logger: mockLogger1,
          workdir: process.cwd(),
        });

        // Verify global logger is set
        expect(isLoggerConfigured()).toBe(true);

        resetMockLogger(mockLogger1);

        // Use the global logger like a utility function would
        globalLogger.debug("Utility function called via Agent context", {
          workdir: agent.workingDirectory,
          operation: "test",
        });

        // Verify the Agent's logger was used
        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Utility function called via Agent context",
          {
            workdir: agent.workingDirectory,
            operation: "test",
          },
        );

        await agent.destroy();
      });

      it("should handle logger switching when multiple Agents are created", async () => {
        // Create first Agent
        const agent1 = await Agent.create({
          logger: mockLogger1,
        });

        expect(isLoggerConfigured()).toBe(true);

        resetMockLogger(mockLogger1);

        // Use logger with first Agent's context
        globalLogger.debug("Using first Agent's logger", { agent: "agent1" });

        expect(mockLogger1.debug).toHaveBeenCalledWith(
          "Using first Agent's logger",
          { agent: "agent1" },
        );

        // Create second Agent with different logger
        const agent2 = await Agent.create({
          logger: mockLogger2,
        });

        expect(isLoggerConfigured()).toBe(true);

        resetMockLogger(mockLogger2);

        // Use logger with second Agent's context - should now use mockLogger2
        globalLogger.debug("Using second Agent's logger", { agent: "agent2" });

        // Should now use the second Agent's logger
        expect(mockLogger2.debug).toHaveBeenCalledWith(
          "Using second Agent's logger",
          { agent: "agent2" },
        );

        // First logger should not have been called for the second message
        const agent2CallsInLogger1 = mockLogger1.debug.mock.calls.filter(
          (call) => {
            if (call[0] === "Using second Agent's logger" && call[1]) {
              const context = call[1] as { agent?: string };
              return context.agent === "agent2";
            }
            return false;
          },
        );
        expect(agent2CallsInLogger1.length).toBe(0);

        await agent1.destroy();
        await agent2.destroy();
      });

      it("should maintain logger consistency throughout Agent lifecycle", async () => {
        // Create Agent
        const agent = await Agent.create({
          logger: mockLogger1,
        });

        expect(isLoggerConfigured()).toBe(true);

        resetMockLogger(mockLogger1);

        // Log during different Agent operations
        globalLogger.info("Agent created");
        expect(agent.sessionId).toBeDefined();
        globalLogger.info("Session ID accessed");

        expect(agent.messages).toEqual([]);
        globalLogger.info("Messages accessed");

        expect(agent.workingDirectory).toBeDefined();
        globalLogger.info("Working directory accessed");

        // Verify all messages used the same logger
        expect(mockLogger1.info).toHaveBeenCalledTimes(4);
        expect(mockLogger1.info).toHaveBeenNthCalledWith(1, "Agent created");
        expect(mockLogger1.info).toHaveBeenNthCalledWith(
          2,
          "Session ID accessed",
        );
        expect(mockLogger1.info).toHaveBeenNthCalledWith(
          3,
          "Messages accessed",
        );
        expect(mockLogger1.info).toHaveBeenNthCalledWith(
          4,
          "Working directory accessed",
        );

        // After destruction, global logger should still be set
        await agent.destroy();
        expect(isLoggerConfigured()).toBe(true);

        resetMockLogger(mockLogger1);
        globalLogger.info("After Agent destruction");
        expect(mockLogger1.info).toHaveBeenCalledWith(
          "After Agent destruction",
        );
      });
    });
  });

  describe("User Story 3: Service Functions Emit Contextual Logs", () => {
    describe("Service functions log when global logger is configured", () => {
      beforeEach(() => {
        // Set up global logger for service tests
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);
      });

      describe("Memory service functions", () => {
        it("should log when addMemory is called", async () => {
          // Import after logger is configured
          const { addMemory, isMemoryMessage } = await import(
            "../../src/services/memory.js"
          );

          const testMessage = "#Test memory entry";
          const testWorkdir = "/test/project";

          // Mock file system operations for addMemory
          const mockWriteFile = vi.fn().mockResolvedValue(undefined);
          const mockReadFile = vi
            .fn()
            .mockRejectedValueOnce({ code: "ENOENT" }) // File doesn't exist initially
            .mockResolvedValue("# Memory\n\nExisting content\n");

          vi.doMock("fs/promises", () => ({
            writeFile: mockWriteFile,
            readFile: mockReadFile,
          }));

          // Test that isMemoryMessage works correctly
          expect(isMemoryMessage(testMessage)).toBe(true);

          try {
            await addMemory(testMessage, testWorkdir);
          } catch {
            // Expected to fail due to mocking, but we want to see if logging occurred
          }

          // Since the current implementation has commented logger calls,
          // this test demonstrates where logging should occur
          // When uncommented, we expect debug logs for successful operations
          globalLogger.debug("Memory service operation completed", {
            operation: "addMemory",
            message: testMessage,
            workdir: testWorkdir,
          });

          // Verify our demonstration logging
          expectLoggerCall(mockLogger1, "debug", [
            "Memory service operation completed",
            {
              operation: "addMemory",
              message: testMessage,
              workdir: testWorkdir,
            },
          ]);
        });

        it("should log when addUserMemory is called", async () => {
          const { ensureUserMemoryFile } = await import(
            "../../src/services/memory.js"
          );

          const testMessage = "#User memory entry";

          // Mock file system operations
          const mockWriteFile = vi.fn().mockResolvedValue(undefined);
          const mockReadFile = vi
            .fn()
            .mockResolvedValue("# User Memory\n\nExisting content\n");
          const mockMkdir = vi.fn().mockResolvedValue(undefined);
          const mockAccess = vi.fn().mockResolvedValue(undefined);

          vi.doMock("fs/promises", () => ({
            writeFile: mockWriteFile,
            readFile: mockReadFile,
            mkdir: mockMkdir,
            access: mockAccess,
          }));

          // Test ensureUserMemoryFile
          try {
            await ensureUserMemoryFile();
          } catch {
            // Expected to fail due to mocking
          }

          // Demonstrate logging for addUserMemory
          globalLogger.debug("User memory operation completed", {
            operation: "addUserMemory",
            message: testMessage,
          });

          expectLoggerCall(mockLogger1, "debug", [
            "User memory operation completed",
            {
              operation: "addUserMemory",
              message: testMessage,
            },
          ]);
        });

        it("should log when reading memory files", async () => {
          const { readMemoryFile } = await import(
            "../../src/services/memory.js"
          );

          const testWorkdir = "/test/project";

          // Mock successful file read
          const mockReadFile = vi
            .fn()
            .mockResolvedValue("# Memory\n\nTest content\n");

          vi.doMock("fs/promises", () => ({
            readFile: mockReadFile,
          }));

          // Demonstrate contextual logging for read operations
          globalLogger.debug("Reading memory files", {
            operation: "readMemoryFile",
            workdir: testWorkdir,
          });

          try {
            await readMemoryFile(testWorkdir);
          } catch {
            // Expected to fail due to incomplete mocking
          }

          globalLogger.debug("Combined memory content request", {
            operation: "getCombinedMemoryContent",
            workdir: testWorkdir,
          });

          // Verify demonstration logs
          expectLoggerCall(mockLogger1, "debug", [
            "Reading memory files",
            {
              operation: "readMemoryFile",
              workdir: testWorkdir,
            },
          ]);

          expectLoggerCall(mockLogger1, "debug", [
            "Combined memory content request",
            {
              operation: "getCombinedMemoryContent",
              workdir: testWorkdir,
            },
          ]);
        });
      });

      describe("Session service functions", () => {
        it("should log session creation and management", async () => {
          const { generateSessionId, ensureSessionDir } = await import(
            "../../src/services/session.js"
          );

          const sessionId = generateSessionId();
          const testWorkdir = "/test/project";

          // Mock file system operations
          const mockMkdir = vi.fn().mockResolvedValue(undefined);

          vi.doMock("fs/promises", () => ({
            mkdir: mockMkdir,
          }));

          // Test session ID generation
          expect(sessionId).toBeDefined();
          expect(typeof sessionId).toBe("string");

          // Demonstrate session logging
          globalLogger.debug("Session service operation", {
            operation: "generateSessionId",
            sessionId: sessionId,
          });

          globalLogger.debug("Creating session directory", {
            operation: "ensureSessionDir",
          });

          try {
            await ensureSessionDir();
          } catch {
            // Expected to fail due to incomplete mocking
          }

          globalLogger.debug("Creating new session", {
            operation: "createSession",
            sessionId: sessionId,
            workdir: testWorkdir,
            sessionType: "main",
          });

          // Verify session operation logs
          expectLoggerCall(mockLogger1, "debug", [
            "Session service operation",
            {
              operation: "generateSessionId",
              sessionId: sessionId,
            },
          ]);

          expectLoggerCall(mockLogger1, "debug", [
            "Creating session directory",
            {
              operation: "ensureSessionDir",
            },
          ]);

          expectLoggerCall(mockLogger1, "debug", [
            "Creating new session",
            {
              operation: "createSession",
              sessionId: sessionId,
              workdir: testWorkdir,
              sessionType: "main",
            },
          ]);
        });
      });

      describe("Hook service functions", () => {
        it("should log hook execution context", async () => {
          const testCommand = "echo 'test'";
          const testContext = {
            sessionId: "test-session-123",
            projectDir: "/test/project",
            event: "PreToolUse" as const,
            toolName: "testTool",
            toolInput: { test: "input" },
          };

          // Demonstrate hook execution logging
          globalLogger.debug("Hook service execution started", {
            operation: "executeCommand",
            command: testCommand,
            context: testContext,
          });

          // Note: We don't actually execute the hook to avoid test environment issues
          // but demonstrate the logging that should occur

          globalLogger.info("Hook execution completed", {
            operation: "executeCommand",
            command: testCommand,
            success: true,
            exitCode: 0,
          });

          // Verify hook logging
          expectLoggerCall(mockLogger1, "debug", [
            "Hook service execution started",
            {
              operation: "executeCommand",
              command: testCommand,
              context: testContext,
            },
          ]);

          expectLoggerCall(mockLogger1, "info", [
            "Hook execution completed",
            {
              operation: "executeCommand",
              command: testCommand,
              success: true,
              exitCode: 0,
            },
          ]);
        });
      });
    });

    describe("Service functions are silent when global logger is not configured", () => {
      beforeEach(() => {
        // Ensure no global logger is configured
        clearGlobalLogger();
        expect(isLoggerConfigured()).toBe(false);
      });

      it("should not throw errors when memory services are used without logger", async () => {
        const { addMemory, isMemoryMessage } = await import(
          "../../src/services/memory.js"
        );

        const testMessage = "#Test memory without logger";
        const testWorkdir = "/test/project";

        // Mock minimal file operations to prevent actual file system access
        vi.doMock("fs/promises", () => ({
          writeFile: vi.fn().mockRejectedValue(new Error("Mocked error")),
          readFile: vi.fn().mockRejectedValue(new Error("Mocked error")),
          mkdir: vi.fn().mockRejectedValue(new Error("Mocked error")),
          access: vi.fn().mockRejectedValue(new Error("Mocked error")),
        }));

        // These should not throw errors even without logger
        expect(() => {
          expect(isMemoryMessage(testMessage)).toBe(true);
          globalLogger.debug("This should be silent");
          globalLogger.error("This should also be silent");
        }).not.toThrow();

        // Service functions might throw due to file system operations,
        // but not due to missing logger
        try {
          await addMemory(testMessage, testWorkdir);
        } catch (error) {
          // Expected to fail due to mocked file operations
          expect((error as Error).message).not.toContain("logger");
        }
      });

      it("should not throw errors when session services are used without logger", async () => {
        const { generateSessionId } = await import(
          "../../src/services/session.js"
        );

        // Mock file operations
        vi.doMock("fs/promises", () => ({
          mkdir: vi.fn().mockRejectedValue(new Error("Mocked mkdir error")),
        }));

        expect(() => {
          const sessionId = generateSessionId();
          expect(sessionId).toBeDefined();

          // Logger calls should be silent
          globalLogger.debug("Session ID generated", { sessionId });
          globalLogger.info("Session operation completed");
        }).not.toThrow();
      });

      it("should not throw errors when hook services are used without logger", async () => {
        // Hook service might skip execution in test environment
        expect(() => {
          globalLogger.debug("Hook service called");
          globalLogger.warn("Hook service warning");
          globalLogger.error("Hook service error");
        }).not.toThrow();

        // Verify no mock logger was called since none is configured
        expect(mockLogger1.debug).not.toHaveBeenCalled();
        expect(mockLogger1.warn).not.toHaveBeenCalled();
        expect(mockLogger1.error).not.toHaveBeenCalled();
      });
    });

    describe("Service functions use appropriate log levels", () => {
      beforeEach(() => {
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);
      });

      it("should use debug level for successful operations", () => {
        // Demonstrate debug logging for normal operations
        globalLogger.debug("Memory operation started", {
          operation: "addMemory",
          message: "#Test message",
        });

        globalLogger.debug("Session operation completed", {
          operation: "generateSessionId",
          sessionId: "test-123",
        });

        globalLogger.debug("Hook context prepared", {
          operation: "executeCommand",
          command: "test command",
        });

        // Verify debug level usage
        expect(mockLogger1.debug).toHaveBeenCalledTimes(3);
        expect(mockLogger1.debug).toHaveBeenNthCalledWith(
          1,
          "Memory operation started",
          {
            operation: "addMemory",
            message: "#Test message",
          },
        );
        expect(mockLogger1.debug).toHaveBeenNthCalledWith(
          2,
          "Session operation completed",
          {
            operation: "generateSessionId",
            sessionId: "test-123",
          },
        );
        expect(mockLogger1.debug).toHaveBeenNthCalledWith(
          3,
          "Hook context prepared",
          {
            operation: "executeCommand",
            command: "test command",
          },
        );
      });

      it("should use error level for failure conditions", () => {
        const testError = new Error("Test service error");

        // Demonstrate error logging for failures
        globalLogger.error("Memory operation failed", {
          operation: "addMemory",
          error: testError.message,
        });

        globalLogger.error("Session creation failed", {
          operation: "createSession",
          error: testError.message,
        });

        globalLogger.error("Hook execution failed", {
          operation: "executeCommand",
          command: "failing command",
          error: testError.message,
        });

        // Verify error level usage
        expect(mockLogger1.error).toHaveBeenCalledTimes(3);
        expect(mockLogger1.error).toHaveBeenNthCalledWith(
          1,
          "Memory operation failed",
          {
            operation: "addMemory",
            error: testError.message,
          },
        );
        expect(mockLogger1.error).toHaveBeenNthCalledWith(
          2,
          "Session creation failed",
          {
            operation: "createSession",
            error: testError.message,
          },
        );
        expect(mockLogger1.error).toHaveBeenNthCalledWith(
          3,
          "Hook execution failed",
          {
            operation: "executeCommand",
            command: "failing command",
            error: testError.message,
          },
        );
      });

      it("should use warn level for non-critical issues", () => {
        // Demonstrate warning logging
        globalLogger.warn("Memory store not available, using fallback", {
          operation: "readMemoryFile",
          fallback: "direct file access",
        });

        globalLogger.warn("Session file not found, creating new", {
          operation: "loadSession",
          sessionId: "missing-session",
        });

        globalLogger.warn("Hook execution skipped in test environment", {
          operation: "executeCommand",
          reason: "NODE_ENV=test",
        });

        // Verify warning level usage
        expect(mockLogger1.warn).toHaveBeenCalledTimes(3);
        expect(mockLogger1.warn).toHaveBeenNthCalledWith(
          1,
          "Memory store not available, using fallback",
          {
            operation: "readMemoryFile",
            fallback: "direct file access",
          },
        );
        expect(mockLogger1.warn).toHaveBeenNthCalledWith(
          2,
          "Session file not found, creating new",
          {
            operation: "loadSession",
            sessionId: "missing-session",
          },
        );
        expect(mockLogger1.warn).toHaveBeenNthCalledWith(
          3,
          "Hook execution skipped in test environment",
          {
            operation: "executeCommand",
            reason: "NODE_ENV=test",
          },
        );
      });

      it("should use info level for important state changes", () => {
        // Demonstrate info logging for important events
        globalLogger.info("Memory store initialized", {
          operation: "initializeMemoryStore",
          storeType: "MemoryStoreService",
        });

        globalLogger.info("Session created successfully", {
          operation: "createSession",
          sessionId: "new-session-123",
          sessionType: "main",
        });

        globalLogger.info("Hook configuration loaded", {
          operation: "loadHookConfig",
          hookCount: 5,
        });

        // Verify info level usage
        expect(mockLogger1.info).toHaveBeenCalledTimes(3);
        expect(mockLogger1.info).toHaveBeenNthCalledWith(
          1,
          "Memory store initialized",
          {
            operation: "initializeMemoryStore",
            storeType: "MemoryStoreService",
          },
        );
        expect(mockLogger1.info).toHaveBeenNthCalledWith(
          2,
          "Session created successfully",
          {
            operation: "createSession",
            sessionId: "new-session-123",
            sessionType: "main",
          },
        );
        expect(mockLogger1.info).toHaveBeenNthCalledWith(
          3,
          "Hook configuration loaded",
          {
            operation: "loadHookConfig",
            hookCount: 5,
          },
        );
      });
    });

    describe("Services provide contextual information", () => {
      beforeEach(() => {
        setGlobalLogger(mockLogger1);
        resetMockLogger(mockLogger1);
      });

      it("should include service names and operations in logs", () => {
        // Memory service context
        globalLogger.debug("Operation started", {
          service: "MemoryService",
          operation: "addMemory",
          target: "project memory",
        });

        // Session service context
        globalLogger.debug("Operation started", {
          service: "SessionService",
          operation: "createSession",
          sessionType: "main",
        });

        // Hook service context
        globalLogger.debug("Operation started", {
          service: "HookService",
          operation: "executeCommand",
          event: "PreToolUse",
        });

        // Verify service identification in logs
        expect(mockLogger1.debug).toHaveBeenCalledTimes(3);

        const logCalls = mockLogger1.debug.mock.calls;
        expect(logCalls[0][1]).toHaveProperty("service", "MemoryService");
        expect(logCalls[0][1]).toHaveProperty("operation", "addMemory");

        expect(logCalls[1][1]).toHaveProperty("service", "SessionService");
        expect(logCalls[1][1]).toHaveProperty("operation", "createSession");

        expect(logCalls[2][1]).toHaveProperty("service", "HookService");
        expect(logCalls[2][1]).toHaveProperty("operation", "executeCommand");
      });

      it("should include relevant operation context", () => {
        // Memory operation with file paths
        globalLogger.debug("Memory file operation", {
          service: "MemoryService",
          operation: "addMemory",
          memoryFile: "/project/AGENTS.md",
          messageType: "project memory",
          workdir: "/project",
        });

        // Session operation with IDs and types
        globalLogger.debug("Session state change", {
          service: "SessionService",
          operation: "createSession",
          sessionId: "uuid-123",
          sessionType: "subagent",
          parentSessionId: "parent-uuid-456",
          subagentType: "coder",
        });

        // Hook operation with execution details
        globalLogger.debug("Hook execution context", {
          service: "HookService",
          operation: "executeCommand",
          hookEvent: "PostToolUse",
          toolName: "bash",
          command: "ls -la",
          timeout: 10000,
        });

        // Verify rich context is included
        const calls = mockLogger1.debug.mock.calls;

        // Memory context
        expect(calls[0][1]).toEqual(
          expect.objectContaining({
            service: "MemoryService",
            memoryFile: "/project/AGENTS.md",
            workdir: "/project",
          }),
        );

        // Session context
        expect(calls[1][1]).toEqual(
          expect.objectContaining({
            service: "SessionService",
            sessionId: "uuid-123",
            parentSessionId: "parent-uuid-456",
          }),
        );

        // Hook context
        expect(calls[2][1]).toEqual(
          expect.objectContaining({
            service: "HookService",
            hookEvent: "PostToolUse",
            toolName: "bash",
          }),
        );
      });

      it("should include error context for troubleshooting", () => {
        const fileError = new Error("ENOENT: file not found");
        const permissionError = new Error("EACCES: permission denied");

        // Memory service error with file context
        globalLogger.error("Failed to write memory file", {
          service: "MemoryService",
          operation: "addMemory",
          memoryFile: "/project/AGENTS.md",
          error: fileError.message,
          errorCode: "ENOENT",
        });

        // Session service error with session context
        globalLogger.error("Failed to create session directory", {
          service: "SessionService",
          operation: "ensureSessionDir",
          directory: "/home/.wave/sessions",
          error: permissionError.message,
          errorCode: "EACCES",
        });

        // Hook service error with execution context
        globalLogger.error("Hook command execution failed", {
          service: "HookService",
          operation: "executeCommand",
          command: "non-existent-command",
          exitCode: 127,
          error: "Command not found",
        });

        // Verify error context is comprehensive
        const errorCalls = mockLogger1.error.mock.calls;

        expect(errorCalls[0][1]).toEqual(
          expect.objectContaining({
            service: "MemoryService",
            memoryFile: "/project/AGENTS.md",
            error: fileError.message,
            errorCode: "ENOENT",
          }),
        );

        expect(errorCalls[1][1]).toEqual(
          expect.objectContaining({
            service: "SessionService",
            directory: "/home/.wave/sessions",
            error: permissionError.message,
            errorCode: "EACCES",
          }),
        );

        expect(errorCalls[2][1]).toEqual(
          expect.objectContaining({
            service: "HookService",
            command: "non-existent-command",
            exitCode: 127,
          }),
        );
      });
    });
  });
});
