import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  JsonlHandler,
  type JsonlWriteOptions,
} from "@/services/jsonlHandler.js";
import type { SessionMessage } from "@/types/session.js";
import type { TextBlock } from "@/types/messaging.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  appendFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
}));

// Mock fileUtils
vi.mock("@/utils/fileUtils.js", () => ({
  getLastLine: vi.fn(),
  readFirstLine: vi.fn(),
}));

describe("JsonlHandler.append()", () => {
  let handler: JsonlHandler;
  let mockAppendFile: ReturnType<typeof vi.fn>;
  let mockWriteFile: ReturnType<typeof vi.fn>;

  const createMessage = (
    content: string,
    role: "user" | "assistant" = "user",
  ): SessionMessage => ({
    role,
    blocks: [{ type: "text", content }],
    timestamp: new Date().toISOString(),
  });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get the mocked functions
    const fsPromises = await import("fs/promises");
    mockAppendFile = vi.mocked(fsPromises.appendFile);
    mockWriteFile = vi.mocked(fsPromises.writeFile);

    // Create fresh handler instance
    handler = new JsonlHandler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should append a single message to JSONL file", async () => {
    const message = createMessage("Test message");

    await handler.append("/test/file.jsonl", [message], { atomic: false });

    expect(mockAppendFile).toHaveBeenCalledOnce();
    // Expect timestamp-first format
    const expectedMessage = {
      timestamp: message.timestamp,
      role: message.role,
      blocks: message.blocks,
    };
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/test/file.jsonl",
      JSON.stringify(expectedMessage) + "\n",
      "utf8",
    );
  });

  it("should use atomic write when atomic option is true", async () => {
    const message = createMessage("Test message");
    const options: JsonlWriteOptions = { atomic: true };

    await handler.append("/test/file.jsonl", [message], options);

    // When atomic is true, it should use writeFile instead of appendFile
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it("should use direct append when atomic option is false", async () => {
    const message = createMessage("Test message");
    const options: JsonlWriteOptions = { atomic: false };

    await handler.append("/test/file.jsonl", [message], options);

    expect(mockAppendFile).toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("should append multiple messages to JSONL file", async () => {
    const messages = [
      createMessage("First message"),
      createMessage("Second message", "assistant"),
    ];

    await handler.append("/test/file.jsonl", messages, { atomic: false });

    expect(mockAppendFile).toHaveBeenCalledOnce();
    // Expect timestamp-first format for both messages
    const expectedMessage1 = {
      timestamp: messages[0].timestamp,
      role: messages[0].role,
      blocks: messages[0].blocks,
    };
    const expectedMessage2 = {
      timestamp: messages[1].timestamp,
      role: messages[1].role,
      blocks: messages[1].blocks,
    };
    const expectedContent =
      JSON.stringify(expectedMessage1) +
      "\n" +
      JSON.stringify(expectedMessage2) +
      "\n";
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/test/file.jsonl",
      expectedContent,
      "utf8",
    );
  });

  it("should handle empty array gracefully", async () => {
    await handler.append("/test/file.jsonl", []);

    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it("should handle fs errors", async () => {
    const message = createMessage("Test message");
    mockAppendFile.mockRejectedValue(new Error("EACCES: permission denied"));

    // The append method should catch and wrap the error
    await expect(
      handler.append("/test/file.jsonl", [message], { atomic: false }),
    ).rejects.toThrow("EACCES: permission denied");
  });

  it("should preserve message structure when appending", async () => {
    const complexMessage: SessionMessage = {
      role: "assistant",
      blocks: [
        { type: "text", content: "Response text" },
        {
          type: "tool",
          stage: "end",
          name: "test-tool",
          parameters: '{"arg": "value"}',
        },
      ],
      timestamp: "2024-01-01T00:00:00.000Z",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
      metadata: {
        model: "test-model",
        temperature: 0.7,
      },
    };

    await handler.append("/test/file.jsonl", [complexMessage], {
      atomic: false,
    });

    // Expect timestamp-first format
    const expectedMessage = {
      timestamp: complexMessage.timestamp,
      role: complexMessage.role,
      blocks: complexMessage.blocks,
      usage: complexMessage.usage,
      metadata: complexMessage.metadata,
    };
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/test/file.jsonl",
      JSON.stringify(expectedMessage) + "\n",
      "utf8",
    );
  });
});

describe("JsonlHandler.read()", () => {
  let handler: JsonlHandler;
  let mockReadFile: ReturnType<typeof vi.fn>;
  let mockStat: ReturnType<typeof vi.fn>;

  const createSampleMessage = (
    role: "user" | "assistant" = "user",
    content = "Test message",
    timestamp = "2024-01-01T00:00:00.000Z",
  ): SessionMessage => ({
    role,
    blocks: [
      {
        type: "text" as const,
        content,
      } as TextBlock,
    ],
    timestamp,
  });

  const createJsonlContent = (messages: SessionMessage[]): string => {
    return (
      messages.map((msg) => JSON.stringify(msg)).join("\n") +
      (messages.length > 0 ? "\n" : "")
    );
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get mocked functions
    const fsPromises = await import("fs/promises");

    mockReadFile = vi.mocked(fsPromises.readFile);
    mockStat = vi.mocked(fsPromises.stat);

    // Set up default mock behaviors
    mockReadFile.mockResolvedValue("");
    mockStat.mockResolvedValue({
      size: 1024,
      birthtime: new Date("2024-01-01T00:00:00.000Z"),
      mtime: new Date("2024-01-01T00:00:00.000Z"),
      atime: new Date("2024-01-01T00:00:00.000Z"),
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    // Create fresh handler instance
    handler = new JsonlHandler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    it("should read messages from existing JSONL file", async () => {
      const messages = [
        createSampleMessage(
          "user",
          "First message",
          "2024-01-01T00:00:00.000Z",
        ),
        createSampleMessage(
          "assistant",
          "Second message",
          "2024-01-01T00:01:00.000Z",
        ),
      ];
      const jsonlContent = createJsonlContent(messages);

      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/file.jsonl");

      expect(mockReadFile).toHaveBeenCalledWith("/test/file.jsonl", "utf8");
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect((result[0].blocks[0] as TextBlock).content).toBe("First message");
      expect(result[1].role).toBe("assistant");
      expect((result[1].blocks[0] as TextBlock).content).toBe("Second message");
    });

    it("should return empty array for empty JSONL file", async () => {
      mockReadFile.mockResolvedValue("");

      const result = await handler.read("/test/empty.jsonl");

      expect(result).toEqual([]);
    });

    it("should handle file with only whitespace", async () => {
      mockReadFile.mockResolvedValue("   \n\n  \t\n   ");

      const result = await handler.read("/test/whitespace.jsonl");

      expect(result).toEqual([]);
    });
  });

  describe("Error handling", () => {
    it("should handle non-existent file gracefully", async () => {
      mockReadFile.mockRejectedValue(
        new Error("ENOENT: no such file or directory"),
      );

      await expect(handler.read("/test/nonexistent.jsonl")).rejects.toThrow(
        'Failed to read JSONL file "/test/nonexistent.jsonl"',
      );
    });

    it("should handle permission denied errors", async () => {
      mockReadFile.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(handler.read("/test/forbidden.jsonl")).rejects.toThrow(
        'Failed to read JSONL file "/test/forbidden.jsonl"',
      );
    });

    it("should fail on malformed JSON lines by default", async () => {
      const invalidJsonContent = `{"role":"user","blocks":[],"timestamp":"2024-01-01T00:00:00.000Z"}
invalid json line
{"role":"assistant","blocks":[],"timestamp":"2024-01-01T00:01:00.000Z"}`;

      mockReadFile.mockResolvedValue(invalidJsonContent);

      await expect(handler.read("/test/invalid.jsonl")).rejects.toThrow(
        "Invalid JSON at line 2",
      );
    });

    it("should handle empty lines in file gracefully", async () => {
      const contentWithEmptyLines = `{"role":"user","blocks":[{"type":"text","content":"Message 1"}],"timestamp":"2024-01-01T00:00:00.000Z"}

{"role":"assistant","blocks":[{"type":"text","content":"Message 2"}],"timestamp":"2024-01-01T00:01:00.000Z"}

`;

      mockReadFile.mockResolvedValue(contentWithEmptyLines);

      const result = await handler.read("/test/emptylines.jsonl");

      expect(result).toHaveLength(2);
      expect((result[0].blocks[0] as TextBlock).content).toBe("Message 1");
      expect((result[1].blocks[0] as TextBlock).content).toBe("Message 2");
    });
  });

  describe("Message format handling", () => {
    it("should handle messages with all optional properties", async () => {
      const complexMessage: SessionMessage = {
        role: "assistant",
        blocks: [
          { type: "text", content: "Response text" },
          {
            type: "tool",
            stage: "end",
            name: "test-tool",
            parameters: '{"arg": "value"}',
          },
        ],
        timestamp: "2024-01-01T00:00:00.000Z",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        metadata: {
          model: "test-model",
          temperature: 0.7,
        },
      };

      const jsonlContent = createJsonlContent([complexMessage]);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/complex.jsonl");

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("assistant");
      expect(result[0].blocks).toHaveLength(2);
      expect(result[0].usage).toEqual(complexMessage.usage);
      expect(result[0].metadata).toEqual(complexMessage.metadata);
    });

    it("should handle messages with minimal properties", async () => {
      const minimalMessage: SessionMessage = {
        role: "user",
        blocks: [{ type: "text", content: "Simple message" }],
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      const jsonlContent = createJsonlContent([minimalMessage]);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/minimal.jsonl");

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      expect(result[0].blocks).toHaveLength(1);
      expect(result[0].usage).toBeUndefined();
      expect(result[0].metadata).toBeUndefined();
    });

    it("should handle messages with special characters", async () => {
      const specialContent =
        'Test with\nNewlines\tTabs\r\nAnd "quotes" and \\backslashes\\';
      const message = createSampleMessage("user", specialContent);

      const jsonlContent = createJsonlContent([message]);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/special.jsonl");

      expect(result).toHaveLength(1);
      expect((result[0].blocks[0] as TextBlock).content).toBe(specialContent);
    });

    it("should handle Unicode content", async () => {
      const unicodeContent = "测试消息 🚀 émojis and üñíçødé";
      const message = createSampleMessage("user", unicodeContent);

      const jsonlContent = createJsonlContent([message]);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/unicode.jsonl");

      expect(result).toHaveLength(1);
      expect((result[0].blocks[0] as TextBlock).content).toBe(unicodeContent);
    });
  });

  describe("Edge cases and performance", () => {
    it("should handle very large message content", async () => {
      const largeContent = "x".repeat(100000); // 100KB content
      const message = createSampleMessage("user", largeContent);

      const jsonlContent = createJsonlContent([message]);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/large.jsonl");

      expect(result).toHaveLength(1);
      expect((result[0].blocks[0] as TextBlock).content).toBe(largeContent);
    });

    it("should handle file with many messages", async () => {
      const messages: SessionMessage[] = [];
      for (let i = 0; i < 1000; i++) {
        messages.push(createSampleMessage("user", `Message ${i}`));
      }

      const jsonlContent = createJsonlContent(messages);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/manyMessages.jsonl");

      expect(result).toHaveLength(1000);
      expect((result[0].blocks[0] as TextBlock).content).toBe("Message 0");
      expect((result[999].blocks[0] as TextBlock).content).toBe("Message 999");
    });

    it("should handle malformed JSON with specific error messages", async () => {
      const malformedContent = `{"role":"user","blocks":[],"timestamp":"2024-01-01T00:00:00.000Z"}
{"role":"user","blocks":[],"timestamp":"2024-01-01T00:01:00.000Z"
{"role":"assistant","blocks":[],"timestamp":"2024-01-01T00:02:00.000Z"}`;

      mockReadFile.mockResolvedValue(malformedContent);

      await expect(handler.read("/test/malformed.jsonl")).rejects.toThrow(
        "Invalid JSON at line 2",
      );
    });

    it("should preserve exact timestamp values", async () => {
      const preciseTimestamp = "2024-01-01T12:34:56.789Z";
      const message = createSampleMessage("user", "Test", preciseTimestamp);

      const jsonlContent = createJsonlContent([message]);
      mockReadFile.mockResolvedValue(jsonlContent);

      const result = await handler.read("/test/timestamp.jsonl");

      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe(preciseTimestamp);
    });

    it("should handle mixed line endings", async () => {
      const messages = [
        createSampleMessage("user", "Message 1"),
        createSampleMessage("assistant", "Message 2"),
      ];

      // Mix different line endings: \n, \r\n
      const mixedLineEndings =
        JSON.stringify(messages[0]) +
        "\r\n" +
        JSON.stringify(messages[1]) +
        "\n";
      mockReadFile.mockResolvedValue(mixedLineEndings);

      const result = await handler.read("/test/mixedLineEndings.jsonl");

      expect(result).toHaveLength(2);
      expect((result[0].blocks[0] as TextBlock).content).toBe("Message 1");
      expect((result[1].blocks[0] as TextBlock).content).toBe("Message 2");
    });
  });
});

describe("JsonlHandler.createSession() - TDD Tests for User Story 1", () => {
  let handler: JsonlHandler;
  let mockWriteFile: ReturnType<typeof vi.fn>;
  let mockMkdir: ReturnType<typeof vi.fn>;
  let mockAppendFile: ReturnType<typeof vi.fn>;
  let mockReadFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get the mocked functions
    const fsPromises = await import("fs/promises");
    mockWriteFile = vi.mocked(fsPromises.writeFile);
    mockMkdir = vi.mocked(fsPromises.mkdir);
    mockAppendFile = vi.mocked(fsPromises.appendFile);
    mockReadFile = vi.mocked(fsPromises.readFile);

    // Create fresh handler instance
    handler = new JsonlHandler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Session creation without metadata header", () => {
    it("should create session file without metadata header", async () => {
      // Create session using the NEW simplified API
      const sessionId = "12345678-1234-1234-1234-123456789abc";
      const sessionType = "main";
      const filePath = `/test/sessions/${handler.generateSessionFilename(sessionId, sessionType)}`;

      await handler.createSession(filePath);

      // Verify file is created with empty content (no metadata header)
      expect(mockWriteFile).toHaveBeenCalledOnce();
      expect(mockWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");

      // Verify directory creation was attempted
      expect(mockMkdir).toHaveBeenCalledWith("/test/sessions", {
        recursive: true,
      });
    });

    it("should create session file that is initially empty and ready for messages", async () => {
      const sessionId = "12345678-1234-1234-1234-123456789abc";
      const filePath = `/test/sessions/${handler.generateSessionFilename(sessionId, "main")}`;

      await handler.createSession(filePath);

      // Verify the file contains NO metadata header (first line should NOT be __meta__: true)
      expect(mockWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");

      // The created file should be completely empty - no metadata line
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe("");
      expect(
        writtenContent.split("\n").filter((line) => line.trim()),
      ).toHaveLength(0);
    });

    it("should create subagent session file without metadata header", async () => {
      const sessionId = "87654321-4321-4321-4321-abcdef123456";
      const filePath = `/test/sessions/${handler.generateSessionFilename(sessionId, "subagent")}`;

      await handler.createSession(filePath);

      // Verify file is created with empty content (no metadata header)
      expect(mockWriteFile).toHaveBeenCalledOnce();
      expect(mockWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");
    });
  });

  describe("Session file contains only messages after creation", () => {
    it("should contain only messages after creation and adding messages", async () => {
      const sessionId = "11111111-2222-3333-4444-555555555555";
      const filePath = `/test/sessions/${handler.generateSessionFilename(sessionId, "main")}`;

      // Create session
      await handler.createSession(filePath);

      // Add messages to the session
      const messages = [
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Hello, world!" }],
          timestamp: "2024-01-01T00:00:00.000Z",
        },
        {
          role: "assistant" as const,
          blocks: [
            { type: "text" as const, content: "Hello! How can I help you?" },
          ],
          timestamp: "2024-01-01T00:01:00.000Z",
        },
      ];

      await handler.append(filePath, messages, { atomic: false });

      // Verify file contains ONLY messages, no metadata header
      expect(mockAppendFile).toHaveBeenCalledOnce();
      const appendedContent = mockAppendFile.mock.calls[0][1] as string;

      // Content should be only JSON lines for messages
      const lines = appendedContent.split("\n").filter((line) => line.trim());
      expect(lines).toHaveLength(2); // Only the 2 messages

      // Each line should be a valid JSON message
      const message1 = JSON.parse(lines[0]);
      const message2 = JSON.parse(lines[1]);

      expect(message1.role).toBe("user");
      expect(message1.blocks[0].content).toBe("Hello, world!");
      expect(message2.role).toBe("assistant");
      expect(message2.blocks[0].content).toBe("Hello! How can I help you?");

      // Most importantly: no metadata line should exist
      expect(lines.some((line) => line.includes("__meta__"))).toBe(false);
    });

    it("should read messages correctly from session file without metadata handling", async () => {
      // Simulate reading a session file that has no metadata header
      const messagesOnlyContent = `{"timestamp":"2024-01-01T00:00:00.000Z","role":"user","blocks":[{"type":"text","content":"Test message 1"}]}
{"timestamp":"2024-01-01T00:01:00.000Z","role":"assistant","blocks":[{"type":"text","content":"Test response 1"}]}`;

      mockReadFile.mockResolvedValue(messagesOnlyContent);

      const result = await handler.read("/test/session.jsonl");

      // Verify messages can be read back correctly
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].blocks[0]).toEqual({
        type: "text",
        content: "Test message 1",
      });
      expect(result[1].role).toBe("assistant");
      expect(result[1].blocks[0]).toEqual({
        type: "text",
        content: "Test response 1",
      });
    });
  });

  describe("Error handling in new session creation", () => {
    it("should handle directory creation errors gracefully", async () => {
      const sessionId = "12345678-1234-1234-1234-123456789abc";
      const filePath = `/test/sessions/${handler.generateSessionFilename(sessionId, "main")}`;

      // Mock mkdir to fail with permission error
      mockMkdir.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(handler.createSession(filePath)).rejects.toThrow(
        "EACCES: permission denied",
      );
    });

    it("should handle file creation errors gracefully", async () => {
      const sessionId = "12345678-1234-1234-1234-123456789abc";
      const filePath = `/test/sessions/${handler.generateSessionFilename(sessionId, "main")}`;

      // Mock writeFile to fail
      mockWriteFile.mockRejectedValue(
        new Error("ENOSPC: no space left on device"),
      );

      await expect(handler.createSession(filePath)).rejects.toThrow(
        "ENOSPC: no space left on device",
      );
    });
  });
});

describe("JsonlHandler filename utilities", () => {
  let handler: JsonlHandler;

  beforeEach(() => {
    handler = new JsonlHandler();
  });

  describe("parseSessionFilename() - TDD Tests for User Story 1", () => {
    describe("Main session filename parsing", () => {
      it("should parse main session filename correctly", () => {
        const result = handler.parseSessionFilename(
          "/path/to/12345678-1234-1234-1234-123456789abc.jsonl",
        );

        expect(result).toEqual({
          sessionId: "12345678-1234-1234-1234-123456789abc",
          sessionType: "main",
        });
      });

      it("should parse main session filename from relative path", () => {
        const result = handler.parseSessionFilename(
          "sessions/abcdef12-3456-789a-bcde-f123456789ab.jsonl",
        );

        expect(result).toEqual({
          sessionId: "abcdef12-3456-789a-bcde-f123456789ab",
          sessionType: "main",
        });
      });

      it("should parse main session filename from just filename", () => {
        const result = handler.parseSessionFilename(
          "11111111-2222-3333-4444-555555555555.jsonl",
        );

        expect(result).toEqual({
          sessionId: "11111111-2222-3333-4444-555555555555",
          sessionType: "main",
        });
      });
    });

    describe("Subagent session filename parsing", () => {
      it("should parse subagent session filename correctly", () => {
        const result = handler.parseSessionFilename(
          "/path/to/subagent-12345678-1234-1234-1234-123456789abc.jsonl",
        );

        expect(result).toEqual({
          sessionId: "12345678-1234-1234-1234-123456789abc",
          sessionType: "subagent",
        });
      });

      it("should parse subagent session filename from relative path", () => {
        const result = handler.parseSessionFilename(
          "sessions/subagent-abcdef12-3456-789a-bcde-f123456789ab.jsonl",
        );

        expect(result).toEqual({
          sessionId: "abcdef12-3456-789a-bcde-f123456789ab",
          sessionType: "subagent",
        });
      });

      it("should parse subagent session filename from just filename", () => {
        const result = handler.parseSessionFilename(
          "subagent-11111111-2222-3333-4444-555555555555.jsonl",
        );

        expect(result).toEqual({
          sessionId: "11111111-2222-3333-4444-555555555555",
          sessionType: "subagent",
        });
      });
    });

    describe("Error handling for invalid filenames", () => {
      it("should throw error for invalid filename formats", () => {
        const invalidFilenames = [
          "/path/to/invalid-filename.jsonl",
          "not-a-session-file.jsonl",
          "session-without-uuid.jsonl",
          "12345678-1234-1234-1234-123456789abc.txt", // Wrong extension
          "subagent-invalid-uuid.jsonl",
          "agent-12345678-1234-1234-1234-123456789abc.jsonl", // Wrong prefix
        ];

        invalidFilenames.forEach((filename) => {
          expect(() => {
            handler.parseSessionFilename(filename);
          }).toThrow(/Invalid session filename format:/);
        });
      });

      it("should handle empty or malformed paths gracefully", () => {
        expect(() => {
          handler.parseSessionFilename("");
        }).toThrow("Invalid session filename format: ");

        expect(() => {
          handler.parseSessionFilename("/");
        }).toThrow("Invalid session filename format: ");

        expect(() => {
          handler.parseSessionFilename("/path/to/");
        }).toThrow("Invalid session filename format: ");
      });
    });
  });

  describe("isValidSessionFilename() - TDD Tests for User Story 1", () => {
    describe("Valid filename recognition", () => {
      it("should validate main session filenames", () => {
        const validMainFilenames = [
          "12345678-1234-1234-1234-123456789abc.jsonl",
          "abcdef12-3456-789a-bcde-f123456789ab.jsonl",
          "11111111-2222-3333-4444-555555555555.jsonl",
          "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl",
        ];

        validMainFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(true);
        });
      });

      it("should validate subagent session filenames", () => {
        const validSubagentFilenames = [
          "subagent-12345678-1234-1234-1234-123456789abc.jsonl",
          "subagent-abcdef12-3456-789a-bcde-f123456789ab.jsonl",
          "subagent-11111111-2222-3333-4444-555555555555.jsonl",
          "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl",
        ];

        validSubagentFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(true);
        });
      });
    });

    describe("Invalid filename rejection", () => {
      it("should reject filenames with wrong extensions", () => {
        const wrongExtensionFilenames = [
          "12345678-1234-1234-1234-123456789abc.txt",
          "12345678-1234-1234-1234-123456789abc.json",
          "subagent-12345678-1234-1234-1234-123456789abc.log",
          "12345678-1234-1234-1234-123456789abc",
        ];

        wrongExtensionFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(false);
        });
      });

      it("should reject filenames with invalid UUID formats", () => {
        const invalidUuidFilenames = [
          "invalid-uuid.jsonl",
          "12345678-1234-1234-1234.jsonl", // Too short
          "12345678-1234-1234-1234-123456789abcd.jsonl", // Too long
          "12345678-1234-1234-1234-123456789abg.jsonl", // Invalid hex char
          "12345678123412341234123456789abc.jsonl", // Missing hyphens
          "subagent-invalid-uuid.jsonl",
          "subagent-12345678-1234-1234-1234.jsonl", // Too short
        ];

        invalidUuidFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(false);
        });
      });

      it("should reject filenames with wrong prefixes", () => {
        const wrongPrefixFilenames = [
          "agent-12345678-1234-1234-1234-123456789abc.jsonl",
          "sub-12345678-1234-1234-1234-123456789abc.jsonl",
          "prefix-12345678-1234-1234-1234-123456789abc.jsonl",
          "main-12345678-1234-1234-1234-123456789abc.jsonl",
        ];

        wrongPrefixFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(false);
        });
      });

      it("should reject empty or malformed filenames", () => {
        const malformedFilenames = [
          "",
          ".jsonl",
          "subagent-.jsonl",
          "subagent-12345678-1234-1234-1234-123456789abc.",
          "12345678-1234-1234-1234-123456789abc.",
        ];

        malformedFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(false);
        });
      });
    });

    describe("Round-trip validation", () => {
      it("should validate filenames generated by generateSessionFilename", () => {
        const sessionIds = [
          "12345678-1234-1234-1234-123456789abc",
          "abcdef12-3456-789a-bcde-f123456789ab",
          "11111111-2222-3333-4444-555555555555",
        ];

        sessionIds.forEach((sessionId) => {
          const mainFilename = handler.generateSessionFilename(
            sessionId,
            "main",
          );
          const subagentFilename = handler.generateSessionFilename(
            sessionId,
            "subagent",
          );

          expect(handler.isValidSessionFilename(mainFilename)).toBe(true);
          expect(handler.isValidSessionFilename(subagentFilename)).toBe(true);

          // Should also be parseable
          const mainParsed = handler.parseSessionFilename(mainFilename);
          const subagentParsed = handler.parseSessionFilename(subagentFilename);

          expect(mainParsed.sessionId).toBe(sessionId);
          expect(mainParsed.sessionType).toBe("main");
          expect(subagentParsed.sessionId).toBe(sessionId);
          expect(subagentParsed.sessionType).toBe("subagent");
        });
      });
    });
  });

  describe("generateSessionFilename() - TDD Tests for User Story 1", () => {
    describe("Main session filename generation", () => {
      it("should generate correct main session filename format", () => {
        const sessionId = "12345678-1234-1234-1234-123456789abc";
        const result = handler.generateSessionFilename(sessionId, "main");

        // Should follow pattern: {sessionId}.jsonl
        expect(result).toBe("12345678-1234-1234-1234-123456789abc.jsonl");
        expect(result).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
        );
      });

      it("should generate unique filenames for different session IDs", () => {
        const sessionId1 = "11111111-1111-1111-1111-111111111111";
        const sessionId2 = "22222222-2222-2222-2222-222222222222";

        const result1 = handler.generateSessionFilename(sessionId1, "main");
        const result2 = handler.generateSessionFilename(sessionId2, "main");

        expect(result1).toBe("11111111-1111-1111-1111-111111111111.jsonl");
        expect(result2).toBe("22222222-2222-2222-2222-222222222222.jsonl");
        expect(result1).not.toBe(result2);
      });

      it("should validate session ID format for main sessions", () => {
        // Valid UUID formats should work
        expect(() => {
          handler.generateSessionFilename(
            "12345678-1234-1234-1234-123456789abc",
            "main",
          );
        }).not.toThrow();

        // Invalid formats should throw
        expect(() => {
          handler.generateSessionFilename("invalid-id", "main");
        }).toThrow("Invalid session ID format: invalid-id");

        expect(() => {
          handler.generateSessionFilename("12345678-1234-1234-1234", "main"); // Too short
        }).toThrow("Invalid session ID format: 12345678-1234-1234-1234");

        expect(() => {
          handler.generateSessionFilename("", "main");
        }).toThrow("Invalid session ID format: ");
      });
    });

    describe("Subagent session filename generation", () => {
      it("should generate correct subagent session filename format", () => {
        const sessionId = "87654321-4321-4321-4321-abcdef123456";
        const result = handler.generateSessionFilename(sessionId, "subagent");

        // Should follow pattern: subagent-{sessionId}.jsonl
        expect(result).toBe(
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl",
        );
        expect(result).toMatch(
          /^subagent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
        );
      });

      it("should generate unique filenames for different subagent session IDs", () => {
        const sessionId1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const sessionId2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

        const result1 = handler.generateSessionFilename(sessionId1, "subagent");
        const result2 = handler.generateSessionFilename(sessionId2, "subagent");

        expect(result1).toBe(
          "subagent-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl",
        );
        expect(result2).toBe(
          "subagent-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl",
        );
        expect(result1).not.toBe(result2);
      });

      it("should validate session ID format for subagent sessions", () => {
        // Valid UUID formats should work
        expect(() => {
          handler.generateSessionFilename(
            "12345678-1234-1234-1234-123456789abc",
            "subagent",
          );
        }).not.toThrow();

        // Invalid formats should throw
        expect(() => {
          handler.generateSessionFilename("invalid-subagent-id", "subagent");
        }).toThrow("Invalid session ID format: invalid-subagent-id");
      });
    });

    describe("Session type differentiation", () => {
      it("should generate different filenames for main vs subagent with same session ID", () => {
        const sessionId = "12345678-1234-1234-1234-123456789abc";

        const mainFilename = handler.generateSessionFilename(sessionId, "main");
        const subagentFilename = handler.generateSessionFilename(
          sessionId,
          "subagent",
        );

        expect(mainFilename).toBe("12345678-1234-1234-1234-123456789abc.jsonl");
        expect(subagentFilename).toBe(
          "subagent-12345678-1234-1234-1234-123456789abc.jsonl",
        );
        expect(mainFilename).not.toBe(subagentFilename);
      });

      it("should enable session type identification from filename alone", () => {
        const sessionId = "99999999-9999-9999-9999-999999999999";

        const mainFilename = handler.generateSessionFilename(sessionId, "main");
        const subagentFilename = handler.generateSessionFilename(
          sessionId,
          "subagent",
        );

        // Should be able to determine type from filename
        expect(mainFilename.startsWith("subagent-")).toBe(false);
        expect(subagentFilename.startsWith("subagent-")).toBe(true);

        // Should be able to parse back correctly
        expect(handler.parseSessionFilename(mainFilename).sessionType).toBe(
          "main",
        );
        expect(handler.parseSessionFilename(subagentFilename).sessionType).toBe(
          "subagent",
        );
      });
    });

    describe("Edge cases and validation", () => {
      it("should handle mixed case UUID properly", () => {
        const mixedCaseId = "AbCdEf12-3456-789A-BcDe-F123456789AB";
        const lowercaseId = mixedCaseId.toLowerCase();

        // Should handle mixed case by converting to lowercase
        const result = handler.generateSessionFilename(lowercaseId, "main");
        expect(result).toBe("abcdef12-3456-789a-bcde-f123456789ab.jsonl");
      });

      it("should reject non-UUID strings", () => {
        const invalidIds = [
          "not-a-uuid",
          "12345678-1234-1234-1234-123456789abg", // Invalid hex character
          "12345678-1234-1234-1234-123456789ab", // Too short
          "12345678-1234-1234-1234-123456789abcd", // Too long
          "12345678123412341234123456789abc", // Missing hyphens
        ];

        invalidIds.forEach((invalidId) => {
          expect(() => {
            handler.generateSessionFilename(invalidId, "main");
          }).toThrow(`Invalid session ID format: ${invalidId}`);
        });
      });
    });
  });

  describe("TDD Tests for User Story 2: Subagent Filename Generation - T019", () => {
    describe("Subagent filename generation tests", () => {
      it("should generate subagent filename with correct prefix format", () => {
        const sessionId = "12345678-1234-1234-1234-123456789abc";
        const result = handler.generateSessionFilename(sessionId, "subagent");

        // Should follow pattern: subagent-{sessionId}.jsonl
        expect(result).toBe(
          "subagent-12345678-1234-1234-1234-123456789abc.jsonl",
        );
        expect(result.startsWith("subagent-")).toBe(true);
        expect(result.endsWith(".jsonl")).toBe(true);
      });

      it("should generate different subagent filenames for different session IDs", () => {
        const sessionId1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        const sessionId2 = "11111111-2222-3333-4444-555555555555";

        const result1 = handler.generateSessionFilename(sessionId1, "subagent");
        const result2 = handler.generateSessionFilename(sessionId2, "subagent");

        expect(result1).toBe(
          "subagent-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
        );
        expect(result2).toBe(
          "subagent-11111111-2222-3333-4444-555555555555.jsonl",
        );
        expect(result1).not.toBe(result2);
      });

      it("should maintain consistency between main and subagent filename generation", () => {
        const sessionId = "87654321-4321-4321-4321-abcdef123456";

        const mainFilename = handler.generateSessionFilename(sessionId, "main");
        const subagentFilename = handler.generateSessionFilename(
          sessionId,
          "subagent",
        );

        // Both should contain the same sessionId
        expect(mainFilename).toBe(`${sessionId}.jsonl`);
        expect(subagentFilename).toBe(`subagent-${sessionId}.jsonl`);

        // Both should be valid
        expect(handler.isValidSessionFilename(mainFilename)).toBe(true);
        expect(handler.isValidSessionFilename(subagentFilename)).toBe(true);
      });

      it("should validate UUID format for subagent session generation", () => {
        // Valid UUID should work
        expect(() => {
          handler.generateSessionFilename(
            "12345678-1234-1234-1234-123456789abc",
            "subagent",
          );
        }).not.toThrow();

        // Invalid UUIDs should throw
        const invalidIds = [
          "invalid-subagent-id",
          "12345678-1234-1234-1234", // Too short
          "12345678-1234-1234-1234-123456789abcd", // Too long
          "12345678123412341234123456789abc", // Missing hyphens
          "",
        ];

        invalidIds.forEach((invalidId) => {
          expect(() => {
            handler.generateSessionFilename(invalidId, "subagent");
          }).toThrow(`Invalid session ID format: ${invalidId}`);
        });
      });
    });

    describe("Subagent filename parsing tests", () => {
      it("should parse subagent filename correctly", () => {
        const testCases = [
          {
            filePath:
              "/path/to/subagent-12345678-1234-1234-1234-123456789abc.jsonl",
            expected: {
              sessionId: "12345678-1234-1234-1234-123456789abc",
              sessionType: "subagent" as const,
            },
          },
          {
            filePath:
              "sessions/subagent-87654321-4321-4321-4321-abcdef123456.jsonl",
            expected: {
              sessionId: "87654321-4321-4321-4321-abcdef123456",
              sessionType: "subagent" as const,
            },
          },
          {
            filePath: "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl",
            expected: {
              sessionId: "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
              sessionType: "subagent" as const,
            },
          },
        ];

        testCases.forEach(({ filePath, expected }) => {
          const result = handler.parseSessionFilename(filePath);
          expect(result).toEqual(expected);
        });
      });

      it("should parse main vs subagent filename formats correctly", () => {
        const sessionId = "12345678-1234-1234-1234-123456789abc";

        const mainResult = handler.parseSessionFilename(`${sessionId}.jsonl`);
        const subagentResult = handler.parseSessionFilename(
          `subagent-${sessionId}.jsonl`,
        );

        expect(mainResult).toEqual({
          sessionId,
          sessionType: "main",
        });

        expect(subagentResult).toEqual({
          sessionId,
          sessionType: "subagent",
        });
      });

      it("should handle parsing edge cases and invalid formats", () => {
        const invalidFilenames = [
          "agent-12345678-1234-1234-1234-123456789abc.jsonl", // Wrong prefix
          "subagent-invalid-uuid.jsonl", // Invalid UUID
          "subagent-12345678-1234-1234-1234.jsonl", // Too short UUID
          "subagent-.jsonl", // Empty UUID
          "subagent-12345678-1234-1234-1234-123456789abc.txt", // Wrong extension
        ];

        invalidFilenames.forEach((filename) => {
          expect(() => {
            handler.parseSessionFilename(filename);
          }).toThrow(/Invalid session filename format:/);
        });
      });
    });

    describe("Subagent filename validation tests", () => {
      it("should validate subagent filenames correctly", () => {
        const validSubagentFilenames = [
          "subagent-12345678-1234-1234-1234-123456789abc.jsonl",
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl",
          "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl",
          "subagent-00000000-0000-0000-0000-000000000000.jsonl",
        ];

        validSubagentFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(true);
        });
      });

      it("should reject invalid subagent filename formats", () => {
        const invalidSubagentFilenames = [
          "agent-12345678-1234-1234-1234-123456789abc.jsonl", // Wrong prefix
          "sub-12345678-1234-1234-1234-123456789abc.jsonl", // Wrong prefix
          "subagent-invalid-uuid.jsonl", // Invalid UUID
          "subagent-12345678-1234-1234-1234.jsonl", // UUID too short
          "subagent-12345678-1234-1234-1234-123456789abcd.jsonl", // UUID too long
          "subagent-12345678-1234-1234-1234-123456789abg.jsonl", // Invalid hex char
          "subagent-12345678123412341234123456789abc.jsonl", // Missing hyphens
          "subagent-12345678-1234-1234-1234-123456789abc.txt", // Wrong extension
          "subagent-12345678-1234-1234-1234-123456789abc", // Missing extension
        ];

        invalidSubagentFilenames.forEach((filename) => {
          expect(handler.isValidSessionFilename(filename)).toBe(false);
        });
      });

      it("should validate round-trip consistency for subagent sessions", () => {
        const sessionIds = [
          "12345678-1234-1234-1234-123456789abc",
          "87654321-4321-4321-4321-abcdef123456",
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
        ];

        sessionIds.forEach((sessionId) => {
          // Generate subagent filename
          const subagentFilename = handler.generateSessionFilename(
            sessionId,
            "subagent",
          );

          // Validate the generated filename
          expect(handler.isValidSessionFilename(subagentFilename)).toBe(true);

          // Parse it back
          const parsed = handler.parseSessionFilename(subagentFilename);
          expect(parsed.sessionId).toBe(sessionId);
          expect(parsed.sessionType).toBe("subagent");
        });
      });
    });

    describe("Session type identification without file content reading", () => {
      it("should identify session type from filename pattern alone", () => {
        const testFilenames = [
          {
            filename: "12345678-1234-1234-1234-123456789abc.jsonl",
            expectedType: "main",
          },
          {
            filename: "subagent-12345678-1234-1234-1234-123456789abc.jsonl",
            expectedType: "subagent",
          },
          {
            filename: "87654321-4321-4321-4321-abcdef123456.jsonl",
            expectedType: "main",
          },
          {
            filename: "subagent-87654321-4321-4321-4321-abcdef123456.jsonl",
            expectedType: "subagent",
          },
        ];

        testFilenames.forEach(({ filename, expectedType }) => {
          // Should be able to determine type without reading file content
          expect(filename.startsWith("subagent-")).toBe(
            expectedType === "subagent",
          );

          // Should parse correctly
          const parsed = handler.parseSessionFilename(filename);
          expect(parsed.sessionType).toBe(expectedType);
        });
      });

      it("should enable efficient session filtering by filename patterns", () => {
        const mixedSessionFiles = [
          "12345678-1234-1234-1234-123456789abc.jsonl", // main
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl", // subagent
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", // main
          "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl", // subagent
          "11111111-2222-3333-4444-555555555555.jsonl", // main
        ];

        // Filter main sessions using filename pattern (no file reading needed)
        const mainSessions = mixedSessionFiles.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            !filename.startsWith("subagent-"),
        );

        // Filter subagent sessions using filename pattern (no file reading needed)
        const subagentSessions = mixedSessionFiles.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            filename.startsWith("subagent-"),
        );

        expect(mainSessions).toHaveLength(3);
        expect(subagentSessions).toHaveLength(2);

        // Verify correct categorization
        mainSessions.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(false);
          const parsed = handler.parseSessionFilename(filename);
          expect(parsed.sessionType).toBe("main");
        });

        subagentSessions.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(true);
          const parsed = handler.parseSessionFilename(filename);
          expect(parsed.sessionType).toBe("subagent");
        });
      });

      it("should support session discovery without content inspection", () => {
        const sessionFiles = [
          "12345678-1234-1234-1234-123456789abc.jsonl",
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl",
          "invalid-filename.jsonl",
          "not-a-session.txt",
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
          "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl",
        ];

        const discoveredSessions = sessionFiles
          .filter((filename) => handler.isValidSessionFilename(filename))
          .map((filename) => {
            try {
              return handler.parseSessionFilename(filename);
            } catch {
              return null;
            }
          })
          .filter((session) => session !== null);

        // Should discover 4 valid sessions
        expect(discoveredSessions).toHaveLength(4);

        // Should have 2 main and 2 subagent sessions
        const mainCount = discoveredSessions.filter(
          (s) => s!.sessionType === "main",
        ).length;
        const subagentCount = discoveredSessions.filter(
          (s) => s!.sessionType === "subagent",
        ).length;

        expect(mainCount).toBe(2);
        expect(subagentCount).toBe(2);
      });
    });
  });
});
