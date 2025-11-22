import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import {
  convertImageToBase64,
  addMemoryBlockToMessage,
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
  addUserMessageToMessages,
  addErrorBlockToMessage,
  extractUserInputHistory,
} from "@/utils/messageOperations.js";
import type { Message } from "@/types/index.js";
import { MessageSource } from "@/types/index.js";

// Mock fs
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

describe("addUserMessageToMessages", () => {
  it("should add user message with text content only", () => {
    const initialMessages: Message[] = [];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "Hello world",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      blocks: [{ type: "text", content: "Hello world" }],
    });
  });

  it("should add user message with single image", () => {
    const initialMessages: Message[] = [];
    const images = [{ path: "/tmp/test-image.png", mimeType: "image/png" }];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "Check this out",
      images,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      blocks: [
        { type: "text", content: "Check this out" },
        {
          type: "image",
          imageUrls: ["/tmp/test-image.png"],
        },
      ],
    });
  });

  it("should add user message with multiple images", () => {
    const initialMessages: Message[] = [];
    const images = [
      { path: "/tmp/image1.png", mimeType: "image/png" },
      { path: "/tmp/image2.jpg", mimeType: "image/jpeg" },
    ];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "Look at these",
      images,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      blocks: [
        { type: "text", content: "Look at these" },
        {
          type: "image",
          imageUrls: ["/tmp/image1.png", "/tmp/image2.jpg"],
        },
      ],
    });
  });

  it("should add user message with only images (no text)", () => {
    const initialMessages: Message[] = [];
    const images = [{ path: "/tmp/test-image.png", mimeType: "image/png" }];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "",
      images,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      blocks: [
        { type: "text", content: "" },
        {
          type: "image",
          imageUrls: ["/tmp/test-image.png"],
        },
      ],
    });
  });

  it("should add to existing messages", () => {
    const initialMessages: Message[] = [
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Previous message" }],
      },
    ];
    const images = [{ path: "/tmp/test.png", mimeType: "image/png" }];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "New message",
      images,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(initialMessages[0]);
    expect(result[1]).toEqual({
      role: "user",
      blocks: [
        { type: "text", content: "New message" },
        {
          type: "image",
          imageUrls: ["/tmp/test.png"],
        },
      ],
    });
  });

  it("should not modify original messages array", () => {
    const initialMessages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Original" }],
      },
    ];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "New message",
    });

    expect(initialMessages).toHaveLength(1);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(initialMessages);
  });
});

describe("convertImageToBase64", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should convert PNG image to base64 data URL", () => {
    // Mock PNG file data
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    vi.mocked(readFileSync).mockReturnValue(pngBuffer);

    const result = convertImageToBase64("/test/image.png");

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(readFileSync).toHaveBeenCalledWith("/test/image.png");

    // Decode base64 and check if it contains PNG signature
    const base64Data = result.split(",")[1];
    const decoded = Buffer.from(base64Data, "base64");
    expect(decoded.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("should handle JPEG files with correct MIME type", () => {
    // Mock JPEG file data (using same binary data but with .jpg extension)
    const jpegBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    vi.mocked(readFileSync).mockReturnValue(jpegBuffer);

    const result = convertImageToBase64("/test/image.jpg");

    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    expect(readFileSync).toHaveBeenCalledWith("/test/image.jpg");
  });

  it("should handle non-existent files gracefully", () => {
    // Mock readFileSync to throw an error (simulating file not found)
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("File not found");
    });

    const result = convertImageToBase64("/tmp/non-existent-image.png");

    // Should return empty base64 placeholder instead of throwing error
    expect(result).toBe("data:image/png;base64,");
    expect(readFileSync).toHaveBeenCalledWith("/tmp/non-existent-image.png");
  });

  it("should handle files with unknown extensions", () => {
    // Mock file data with unknown extension
    const unknownBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    vi.mocked(readFileSync).mockReturnValue(unknownBuffer);

    const result = convertImageToBase64("/test/image.unknown");

    // Should default to PNG MIME type
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(readFileSync).toHaveBeenCalledWith("/test/image.unknown");
  });
});

describe("addMemoryBlockToMessage", () => {
  it("should create a new assistant message with MemoryBlock", () => {
    const initialMessages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      },
    ];

    const result = addMemoryBlockToMessage({
      messages: initialMessages,
      content: "Remember this important information",
      isSuccess: true,
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: "assistant",
      blocks: [
        {
          type: "memory",
          content: "Remember this important information",
          isSuccess: true,
        },
      ],
    });
  });

  it("should create a new assistant message with failed MemoryBlock", () => {
    const initialMessages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      },
    ];

    const result = addMemoryBlockToMessage({
      messages: initialMessages,
      content: "Memory addition failed: Insufficient disk space",
      isSuccess: false,
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: "assistant",
      blocks: [
        {
          type: "memory",
          content: "Memory addition failed: Insufficient disk space",
          isSuccess: false,
        },
      ],
    });
  });

  it("should work with empty message list", () => {
    const initialMessages: Message[] = [];

    const result = addMemoryBlockToMessage({
      messages: initialMessages,
      content: "First memory",
      isSuccess: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      blocks: [
        {
          type: "memory",
          content: "First memory",
          isSuccess: true,
        },
      ],
    });
  });

  it("should not modify the original messages array", () => {
    const initialMessages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      },
    ];

    const result = addMemoryBlockToMessage({
      messages: initialMessages,
      content: "Memory content",
      isSuccess: true,
    });

    expect(initialMessages).toHaveLength(1);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(initialMessages);
  });
});

describe("Command Output Message Operations", () => {
  describe("addCommandOutputMessage", () => {
    it("should add a new command output message", () => {
      const initialMessages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "!echo hello" }],
        },
      ];

      const result = addCommandOutputMessage({
        messages: initialMessages,
        command: "echo hello",
      });

      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({
        role: "assistant",
        blocks: [
          {
            type: "command_output",
            command: "echo hello",
            output: "",
            isRunning: true,
            exitCode: null,
          },
        ],
      });
    });

    it("should work with empty message list", () => {
      const initialMessages: Message[] = [];

      const result = addCommandOutputMessage({
        messages: initialMessages,
        command: "ls -la",
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        blocks: [
          {
            type: "command_output",
            command: "ls -la",
            output: "",
            isRunning: true,
            exitCode: null,
          },
        ],
      });
    });

    it("should not modify the original messages array", () => {
      const initialMessages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "test" }],
        },
      ];

      const result = addCommandOutputMessage({
        messages: initialMessages,
        command: "pwd",
      });

      expect(initialMessages).toHaveLength(1);
      expect(result).toHaveLength(2);
      expect(result).not.toBe(initialMessages);
    });
  });

  describe("updateCommandOutputInMessage", () => {
    it("should update output in the correct command block", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo hello",
              output: "",
              isRunning: true,
              exitCode: null,
            },
          ],
        },
      ];

      const result = updateCommandOutputInMessage({
        messages: initialMessages,
        command: "echo hello",
        output: "hello\n",
      });

      expect(result[0].blocks[0]).toMatchObject({
        type: "command_output",
        command: "echo hello",
        output: "hello",
        isRunning: true,
        exitCode: null,
      });
    });

    it("should update the correct command when multiple commands exist", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo first",
              output: "first",
              isRunning: false,
              exitCode: 0,
            },
          ],
        },
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo second",
              output: "",
              isRunning: true,
              exitCode: null,
            },
          ],
        },
      ];

      const result = updateCommandOutputInMessage({
        messages: initialMessages,
        command: "echo second",
        output: "second\n",
      });

      // First command should remain unchanged
      expect(result[0].blocks[0]).toMatchObject({
        command: "echo first",
        output: "first",
        isRunning: false,
      });

      // Second command should be updated
      expect(result[1].blocks[0]).toMatchObject({
        command: "echo second",
        output: "second",
        isRunning: true,
      });
    });

    it("should trim the output", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo test",
              output: "",
              isRunning: true,
              exitCode: null,
            },
          ],
        },
      ];

      const result = updateCommandOutputInMessage({
        messages: initialMessages,
        command: "echo test",
        output: "  test output  \n",
      });

      expect(result[0].blocks[0]).toMatchObject({
        output: "test output",
      });
    });

    it("should not update if no matching running command is found", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo hello",
              output: "hello",
              isRunning: false,
              exitCode: 0,
            },
          ],
        },
      ];

      const result = updateCommandOutputInMessage({
        messages: initialMessages,
        command: "echo hello",
        output: "new output",
      });

      // Should not update because the command is not running
      expect(result[0].blocks[0]).toMatchObject({
        output: "hello",
        isRunning: false,
      });
    });
  });

  describe("completeCommandInMessage", () => {
    it("should mark command as completed with exit code", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo hello",
              output: "hello",
              isRunning: true,
              exitCode: null,
            },
          ],
        },
      ];

      const result = completeCommandInMessage({
        messages: initialMessages,
        command: "echo hello",
        exitCode: 0,
      });

      expect(result[0].blocks[0]).toMatchObject({
        type: "command_output",
        command: "echo hello",
        output: "hello",
        isRunning: false,
        exitCode: 0,
      });
    });

    it("should handle error exit codes", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "ls /nonexistent",
              output: "ls: /nonexistent: No such file or directory",
              isRunning: true,
              exitCode: null,
            },
          ],
        },
      ];

      const result = completeCommandInMessage({
        messages: initialMessages,
        command: "ls /nonexistent",
        exitCode: 1,
      });

      expect(result[0].blocks[0]).toMatchObject({
        isRunning: false,
        exitCode: 1,
      });
    });

    it("should complete the correct command when multiple commands exist", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo first",
              output: "first",
              isRunning: false,
              exitCode: 0,
            },
          ],
        },
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo second",
              output: "second",
              isRunning: true,
              exitCode: null,
            },
          ],
        },
      ];

      const result = completeCommandInMessage({
        messages: initialMessages,
        command: "echo second",
        exitCode: 0,
      });

      // First command should remain unchanged
      expect(result[0].blocks[0]).toMatchObject({
        command: "echo first",
        isRunning: false,
        exitCode: 0,
      });

      // Second command should be completed
      expect(result[1].blocks[0]).toMatchObject({
        command: "echo second",
        isRunning: false,
        exitCode: 0,
      });
    });

    it("should not modify if no matching running command is found", () => {
      const initialMessages: Message[] = [
        {
          role: "assistant",
          blocks: [
            {
              type: "command_output",
              command: "echo hello",
              output: "hello",
              isRunning: false,
              exitCode: 0,
            },
          ],
        },
      ];

      const result = completeCommandInMessage({
        messages: initialMessages,
        command: "echo hello",
        exitCode: 1,
      });

      // Should not modify because command is not running
      expect(result[0].blocks[0]).toMatchObject({
        isRunning: false,
        exitCode: 0, // Original exit code should remain
      });
    });
  });
});

describe("addErrorBlockToMessage", () => {
  it("should add error block to the last assistant message", () => {
    const initialMessages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
      },
    ];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Something went wrong",
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: "assistant",
      blocks: [
        { type: "text", content: "Hi there!" },
        { type: "error", content: "Something went wrong" },
      ],
    });
  });

  it("should create new assistant message when last message is not assistant", () => {
    const initialMessages: Message[] = [
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello again" }],
      },
    ];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Error occurred",
    });

    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({
      role: "assistant",
      blocks: [{ type: "error", content: "Error occurred" }],
    });
    // Original messages should remain unchanged
    expect(result[0]).toEqual(initialMessages[0]);
    expect(result[1]).toEqual(initialMessages[1]);
  });

  it("should create new assistant message when messages array is empty", () => {
    const initialMessages: Message[] = [];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Initial error",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      blocks: [{ type: "error", content: "Initial error" }],
    });
  });

  it("should add error block to last assistant message when multiple assistant messages exist", () => {
    const initialMessages: Message[] = [
      {
        role: "assistant",
        blocks: [{ type: "text", content: "First response" }],
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "Follow-up" }],
      },
      {
        role: "assistant",
        blocks: [
          { type: "text", content: "Second response" },
          { type: "tool", parameters: "ls", stage: "end" },
        ],
      },
    ];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Tool execution failed",
    });

    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({
      role: "assistant",
      blocks: [
        { type: "text", content: "Second response" },
        { type: "tool", parameters: "ls", stage: "end" },
        { type: "error", content: "Tool execution failed" },
      ],
    });
    // Earlier messages should remain unchanged
    expect(result[0]).toEqual(initialMessages[0]);
    expect(result[1]).toEqual(initialMessages[1]);
  });

  it("should not mutate original messages array", () => {
    const initialMessages: Message[] = [
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Original" }],
      },
    ];
    const originalLength = initialMessages[0].blocks.length;

    addErrorBlockToMessage({
      messages: initialMessages,
      error: "Test error",
    });

    // Original array should not be modified
    expect(initialMessages[0].blocks).toHaveLength(originalLength);
    expect(initialMessages[0].blocks[0]).toEqual({
      type: "text",
      content: "Original",
    });
  });
});

describe("extractUserInputHistory", () => {
  it("should extract text content from user messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello world" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Assistant response" }],
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "Second user message" }],
      },
    ];

    const result = extractUserInputHistory(messages);

    expect(result).toEqual(["Hello world", "Second user message"]);
  });

  it("should exclude text blocks with HOOK source from user history", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [
          { type: "text", content: "User input", source: MessageSource.USER },
        ],
      },
      {
        role: "user",
        blocks: [
          { type: "text", content: "Hook message", source: MessageSource.HOOK },
        ],
      },
      {
        role: "user",
        blocks: [
          { type: "text", content: "Regular message" }, // No source specified
          {
            type: "text",
            content: "Another hook message",
            source: MessageSource.HOOK,
          },
        ],
      },
    ];

    const result = extractUserInputHistory(messages);

    expect(result).toEqual(["User input", "Regular message"]);
  });

  it("should filter out empty text content", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "" }],
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "   " }], // Whitespace only
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "Valid content" }],
      },
    ];

    const result = extractUserInputHistory(messages);

    expect(result).toEqual(["Valid content"]);
  });

  it("should handle mixed block types and extract only text blocks", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [
          { type: "text", content: "Text content" },
          { type: "error", content: "Error content" },
          { type: "text", content: "More text" },
        ],
      },
    ];

    const result = extractUserInputHistory(messages);

    expect(result).toEqual(["Text content More text"]);
  });
});
