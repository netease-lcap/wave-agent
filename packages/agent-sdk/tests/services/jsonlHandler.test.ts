import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  JsonlHandler,
  type JsonlWriteOptions,
} from "@/services/jsonlHandler.js";
import type { SessionMessage, SessionMetadataLine } from "@/types/session.js";
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

  describe("Limit parameter", () => {
    it("should respect limit parameter", async () => {
      const messages = [
        createSampleMessage("user", "Message 1"),
        createSampleMessage("assistant", "Message 2"),
        createSampleMessage("user", "Message 3"),
      ];
      const jsonlContent = createJsonlContent(messages);
      mockReadFile.mockResolvedValue(jsonlContent);

      const options = { limit: 2 };
      const result = await handler.read("/test/file.jsonl", options);

      expect(result).toHaveLength(2);
      expect((result[0].blocks[0] as TextBlock).content).toBe("Message 1");
      expect((result[1].blocks[0] as TextBlock).content).toBe("Message 2");
    });

    it("should handle limit larger than available messages", async () => {
      const messages = [createSampleMessage("user", "Only message")];
      const jsonlContent = createJsonlContent(messages);
      mockReadFile.mockResolvedValue(jsonlContent);

      const options = { limit: 10 };
      const result = await handler.read("/test/file.jsonl", options);

      expect(result).toHaveLength(1);
      expect((result[0].blocks[0] as TextBlock).content).toBe("Only message");
    });

    it("should handle limit of 0", async () => {
      const messages = [createSampleMessage("user", "Message")];
      const jsonlContent = createJsonlContent(messages);
      mockReadFile.mockResolvedValue(jsonlContent);

      const options = { limit: 0 };
      const result = await handler.read("/test/file.jsonl", options);

      expect(result).toHaveLength(0);
    });

    it("should handle negative limit gracefully", async () => {
      const messages = [createSampleMessage("user", "Message")];
      const jsonlContent = createJsonlContent(messages);
      mockReadFile.mockResolvedValue(jsonlContent);

      const options = { limit: -5 };
      const result = await handler.read("/test/file.jsonl", options);

      expect(result).toHaveLength(0);
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

describe("JsonlHandler.readMetadata()", () => {
  let handler: JsonlHandler;
  let mockStat: ReturnType<typeof vi.fn>;
  let mockReadFirstLine: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const fsPromises = await import("fs/promises");
    const fileUtils = await import("@/utils/fileUtils.js");

    mockStat = vi.mocked(fsPromises.stat);
    mockReadFirstLine = vi.mocked(fileUtils.readFirstLine);

    mockStat.mockResolvedValue({
      size: 1024,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    handler = new JsonlHandler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should read metadata from first line", async () => {
    const metadata: SessionMetadataLine = {
      __meta__: true,
      sessionId: "test-session",
      sessionType: "main",
      workdir: "/test/workdir",
      startedAt: "2024-01-01T00:00:00.000Z",
    };

    mockReadFirstLine.mockResolvedValue(JSON.stringify(metadata));

    const result = await handler.readMetadata("/test/file.jsonl");

    expect(result).toEqual(metadata);
    expect(mockReadFirstLine).toHaveBeenCalledWith("/test/file.jsonl");
  });

  it("should return null for non-existent file", async () => {
    mockStat.mockRejectedValue({ code: "ENOENT" });

    const result = await handler.readMetadata("/test/nonexistent.jsonl");

    expect(result).toBeNull();
  });

  it("should return null when first line is not metadata", async () => {
    const regularMessage = {
      role: "user",
      blocks: [{ type: "text", content: "Regular message" }],
      timestamp: "2024-01-01T00:00:00.000Z",
    };

    mockReadFirstLine.mockResolvedValue(JSON.stringify(regularMessage));

    const result = await handler.readMetadata("/test/file.jsonl");

    expect(result).toBeNull();
    expect(mockReadFirstLine).toHaveBeenCalledWith("/test/file.jsonl");
  });

  it("should return null for invalid JSON on first line", async () => {
    mockReadFirstLine.mockResolvedValue("invalid json");

    const result = await handler.readMetadata("/test/file.jsonl");

    expect(result).toBeNull();
    expect(mockReadFirstLine).toHaveBeenCalledWith("/test/file.jsonl");
  });
});

describe("JsonlHandler.hasMetadata()", () => {
  let handler: JsonlHandler;
  let mockStat: ReturnType<typeof vi.fn>;
  let mockReadFirstLine: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const fsPromises = await import("fs/promises");
    const fileUtils = await import("@/utils/fileUtils.js");

    mockStat = vi.mocked(fsPromises.stat);
    mockReadFirstLine = vi.mocked(fileUtils.readFirstLine);

    mockStat.mockResolvedValue({
      size: 1024,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    handler = new JsonlHandler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return true when file has metadata", async () => {
    const metadata = {
      __meta__: true,
      sessionId: "test-session",
      sessionType: "main",
      workdir: "/test/workdir",
      startedAt: "2024-01-01T00:00:00.000Z",
    };

    mockReadFirstLine.mockResolvedValue(JSON.stringify(metadata));

    const result = await handler.hasMetadata("/test/file.jsonl");

    expect(result).toBe(true);
    expect(mockReadFirstLine).toHaveBeenCalledWith("/test/file.jsonl");
  });

  it("should return false when file has no metadata", async () => {
    const regularMessage = {
      role: "user",
      blocks: [{ type: "text", content: "Regular message" }],
      timestamp: "2024-01-01T00:00:00.000Z",
    };

    mockReadFirstLine.mockResolvedValue(JSON.stringify(regularMessage));

    const result = await handler.hasMetadata("/test/file.jsonl");

    expect(result).toBe(false);
    expect(mockReadFirstLine).toHaveBeenCalledWith("/test/file.jsonl");
  });

  it("should return false for non-existent file", async () => {
    mockStat.mockRejectedValue({ code: "ENOENT" });

    const result = await handler.hasMetadata("/test/nonexistent.jsonl");

    expect(result).toBe(false);
  });
});
