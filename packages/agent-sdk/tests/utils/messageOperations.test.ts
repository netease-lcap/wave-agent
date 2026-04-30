import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import {
  convertImageToBase64,
  addBangMessage,
  updateBangInMessage,
  completeBangInMessage,
  addUserMessageToMessages,
  updateUserMessageInMessages,
  addErrorBlockToMessage,
  generateMessageId,
  addToolBlockToMessageInMessages,
  updateToolBlockInMessage,
  cloneMessage,
  getMessageContent,
} from "@/utils/messageOperations.js";
import type {
  Message,
  ToolBlock,
  ImageBlock,
  FileHistoryBlock,
} from "@/types/index.js";

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
    expect(result[0]).toMatchObject({
      role: "user",
      blocks: [{ type: "text", content: "Hello world" }],
      timestamp: expect.any(String),
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
    expect(result[0]).toMatchObject({
      role: "user",
      blocks: [
        { type: "text", content: "Check this out" },
        {
          type: "image",
          imageUrls: ["/tmp/test-image.png"],
        },
      ],
      timestamp: expect.any(String),
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
    expect(result[0]).toMatchObject({
      role: "user",
      blocks: [
        { type: "text", content: "Look at these" },
        {
          type: "image",
          imageUrls: ["/tmp/image1.png", "/tmp/image2.jpg"],
        },
      ],
      timestamp: expect.any(String),
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
    expect(result[0]).toMatchObject({
      role: "user",
      blocks: [
        { type: "text", content: "" },
        {
          type: "image",
          imageUrls: ["/tmp/test-image.png"],
        },
      ],
      timestamp: expect.any(String),
    });
  });

  it("should add to existing messages", () => {
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Previous message" }],
        timestamp: expect.any(String),
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
    expect(result[1]).toMatchObject({
      role: "user",
      blocks: [
        { type: "text", content: "New message" },
        {
          type: "image",
          imageUrls: ["/tmp/test.png"],
        },
      ],
      timestamp: expect.any(String),
    });
  });

  it("should not modify original messages array", () => {
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Original" }],
        timestamp: expect.any(String),
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

  it("should add user message with isMeta flag", () => {
    const initialMessages: Message[] = [];

    const result = addUserMessageToMessages({
      messages: initialMessages,
      content: "Hidden message",
      isMeta: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: "user",
      blocks: [{ type: "text", content: "Hidden message" }],
      isMeta: true,
      timestamp: expect.any(String),
    });
  });
});

describe("updateUserMessageInMessages", () => {
  it("should update user message content and isMeta flag", () => {
    const id = generateMessageId();
    const initialMessages: Message[] = [
      {
        id,
        role: "user",
        blocks: [{ type: "text", content: "Original" }],
        timestamp: expect.any(String),
      },
    ];

    const result = updateUserMessageInMessages(initialMessages, id, {
      content: "Updated",
      isMeta: true,
    });

    expect(result[0]).toMatchObject({
      id,
      role: "user",
      blocks: [{ type: "text", content: "Updated" }],
      isMeta: true,
      timestamp: expect.any(String),
    });
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

describe("Bang Message Operations", () => {
  describe("addBangMessage", () => {
    it("should add a new command output message", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [{ type: "text", content: "!echo hello" }],
          timestamp: expect.any(String),
        },
      ];

      const result = addBangMessage({
        messages: initialMessages,
        command: "echo hello",
      });

      expect(result).toHaveLength(2);
      expect(result[1]).toMatchObject({
        role: "user",
        blocks: [
          {
            type: "bang",
            command: "echo hello",
            output: "",
            stage: "running",
            exitCode: null,
          },
        ],
        timestamp: expect.any(String),
      });
    });

    it("should work with empty message list", () => {
      const initialMessages: Message[] = [];

      const result = addBangMessage({
        messages: initialMessages,
        command: "ls -la",
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        role: "user",
        blocks: [
          {
            type: "bang",
            command: "ls -la",
            output: "",
            stage: "running",
            exitCode: null,
          },
        ],
        timestamp: expect.any(String),
      });
    });

    it("should not modify the original messages array", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [{ type: "text", content: "test" }],
          timestamp: expect.any(String),
        },
      ];

      const result = addBangMessage({
        messages: initialMessages,
        command: "pwd",
      });

      expect(initialMessages).toHaveLength(1);
      expect(result).toHaveLength(2);
      expect(result).not.toBe(initialMessages);
    });
  });

  describe("updateBangInMessage", () => {
    it("should update output in the correct command block", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo hello",
              output: "",
              stage: "running",
              exitCode: null,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = updateBangInMessage({
        messages: initialMessages,
        command: "echo hello",
        output: "hello\n",
      });

      expect(result[0].blocks[0]).toMatchObject({
        type: "bang",
        command: "echo hello",
        output: "hello",
        stage: "running",
        exitCode: null,
      });
    });

    it("should update the correct command when multiple commands exist", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo first",
              output: "first",
              stage: "end",
              exitCode: 0,
            },
          ],
          timestamp: expect.any(String),
        },
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo second",
              output: "",
              stage: "running",
              exitCode: null,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = updateBangInMessage({
        messages: initialMessages,
        command: "echo second",
        output: "second\n",
      });

      // First command should remain unchanged
      expect(result[0].blocks[0]).toMatchObject({
        command: "echo first",
        output: "first",
        stage: "end",
      });

      // Second command should be updated
      expect(result[1].blocks[0]).toMatchObject({
        command: "echo second",
        output: "second",
        stage: "running",
      });
    });

    it("should trim the output", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo test",
              output: "",
              stage: "running",
              exitCode: null,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = updateBangInMessage({
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
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo hello",
              output: "hello",
              stage: "end",
              exitCode: 0,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = updateBangInMessage({
        messages: initialMessages,
        command: "echo hello",
        output: "new output",
      });

      // Should not update because the command is not running
      expect(result[0].blocks[0]).toMatchObject({
        output: "hello",
        stage: "end",
      });
    });
  });

  describe("completeBangInMessage", () => {
    it("should mark command as completed with exit code and output", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo hello",
              output: "",
              stage: "running",
              exitCode: null,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = completeBangInMessage({
        messages: initialMessages,
        command: "echo hello",
        exitCode: 0,
        output: "hello\n",
      });

      expect(result[0].blocks[0]).toMatchObject({
        type: "bang",
        command: "echo hello",
        output: "hello",
        stage: "end",
        exitCode: 0,
      });
    });

    it("should handle error exit codes", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "ls /nonexistent",
              output: "ls: /nonexistent: No such file or directory",
              stage: "running",
              exitCode: null,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = completeBangInMessage({
        messages: initialMessages,
        command: "ls /nonexistent",
        exitCode: 1,
      });

      expect(result[0].blocks[0]).toMatchObject({
        stage: "end",
        exitCode: 1,
      });
    });

    it("should complete the correct command when multiple commands exist", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo first",
              output: "first",
              stage: "end",
              exitCode: 0,
            },
          ],
          timestamp: expect.any(String),
        },
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo second",
              output: "second",
              stage: "running",
              exitCode: null,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = completeBangInMessage({
        messages: initialMessages,
        command: "echo second",
        exitCode: 0,
      });

      // First command should remain unchanged
      expect(result[0].blocks[0]).toMatchObject({
        command: "echo first",
        stage: "end",
        exitCode: 0,
      });

      // Second command should be completed
      expect(result[1].blocks[0]).toMatchObject({
        command: "echo second",
        stage: "end",
        exitCode: 0,
      });
    });

    it("should not modify if no matching running command is found", () => {
      const initialMessages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            {
              type: "bang",
              command: "echo hello",
              output: "hello",
              stage: "end",
              exitCode: 0,
            },
          ],
          timestamp: expect.any(String),
        },
      ];

      const result = completeBangInMessage({
        messages: initialMessages,
        command: "echo hello",
        exitCode: 1,
      });

      // Should not modify because command is not running
      expect(result[0].blocks[0]).toMatchObject({
        stage: "end",
        exitCode: 0, // Original exit code should remain
      });
    });
  });
});

describe("addErrorBlockToMessage", () => {
  it("should add error block to the last assistant message", () => {
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
        timestamp: expect.any(String),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
        timestamp: expect.any(String),
      },
    ];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Something went wrong",
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", content: "Hi there!" },
        { type: "error", content: "Something went wrong" },
      ],
      timestamp: expect.any(String),
    });
  });

  it("should create new assistant message when last message is not assistant", () => {
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
        timestamp: expect.any(String),
      },
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hello again" }],
        timestamp: expect.any(String),
      },
    ];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Error occurred",
    });

    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({
      role: "assistant",
      blocks: [{ type: "error", content: "Error occurred" }],
      timestamp: expect.any(String),
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
    expect(result[0]).toMatchObject({
      role: "assistant",
      blocks: [{ type: "error", content: "Initial error" }],
      timestamp: expect.any(String),
    });
  });

  it("should add error block to last assistant message when multiple assistant messages exist", () => {
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "First response" }],
        timestamp: expect.any(String),
      },
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Follow-up" }],
        timestamp: expect.any(String),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          { type: "text", content: "Second response" },
          { type: "tool", parameters: "ls", stage: "end" },
        ],
        timestamp: expect.any(String),
      },
    ];

    const result = addErrorBlockToMessage({
      messages: initialMessages,
      error: "Tool execution failed",
    });

    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({
      role: "assistant",
      blocks: [
        { type: "text", content: "Second response" },
        { type: "tool", parameters: "ls", stage: "end" },
        { type: "error", content: "Tool execution failed" },
      ],
      timestamp: expect.any(String),
    });
    // Earlier messages should remain unchanged
    expect(result[0]).toEqual(initialMessages[0]);
    expect(result[1]).toEqual(initialMessages[1]);
  });

  it("should not mutate original messages array", () => {
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Original" }],
        timestamp: expect.any(String),
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

describe("addToolBlockToMessageInMessages", () => {
  it("should add a tool block to a specific user message", () => {
    const messageId = generateMessageId();
    const initialMessages: Message[] = [
      {
        id: messageId,
        role: "user",
        blocks: [{ type: "text", content: "/forked-skill" }],
        timestamp: expect.any(String),
      },
    ];

    const { messages, toolBlockId } = addToolBlockToMessageInMessages(
      initialMessages,
      messageId,
      {
        name: "test-tool",
        parameters: "{}",
      },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].blocks).toHaveLength(2);
    expect(messages[0].blocks[1]).toMatchObject({
      type: "tool",
      id: toolBlockId,
      name: "test-tool",
      parameters: "{}",
      stage: "start",
    });
  });

  it("should not add a tool block if message ID does not match", () => {
    const initialMessages: Message[] = [
      {
        id: "wrong-id",
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
        timestamp: expect.any(String),
      },
    ];

    const { messages } = addToolBlockToMessageInMessages(
      initialMessages,
      "target-id",
      { name: "test" },
    );

    expect(messages[0].blocks).toHaveLength(1);
  });
});

describe("updateToolBlockInMessage with messageId", () => {
  it("should update a tool block in a specific user message", () => {
    const messageId = generateMessageId();
    const toolBlockId = "tool-123";
    const initialMessages: Message[] = [
      {
        id: messageId,
        role: "user",
        blocks: [
          { type: "text", content: "/forked-skill" },
          {
            type: "tool",
            id: toolBlockId,
            name: "test-tool",
            parameters: "{}",
            result: "",
            stage: "start",
          },
        ],
        timestamp: expect.any(String),
      },
    ];

    const result = updateToolBlockInMessage({
      messages: initialMessages,
      id: toolBlockId,
      messageId: messageId,
      stage: "end",
      result: "success",
    });

    expect(result[0].blocks[1]).toMatchObject({
      id: toolBlockId,
      stage: "end",
      result: "success",
    });
  });

  it("should update a tool block in a user message without messageId (searching)", () => {
    const toolBlockId = "tool-123";
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [
          { type: "text", content: "/forked-skill" },
          {
            type: "tool",
            id: toolBlockId,
            name: "test-tool",
            parameters: "{}",
            result: "",
            stage: "start",
          },
        ],
        timestamp: expect.any(String),
      },
    ];

    const result = updateToolBlockInMessage({
      messages: initialMessages,
      id: toolBlockId,
      stage: "end",
      result: "success",
    });

    expect(result[0].blocks[1]).toMatchObject({
      id: toolBlockId,
      stage: "end",
      result: "success",
    });
  });

  it("should update all optional fields in a tool block", () => {
    const toolBlockId = "tool-123";
    const initialMessages: Message[] = [
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: toolBlockId,
            name: "test-tool",
            parameters: "{}",
            result: "",
            stage: "start",
          },
        ],
        timestamp: expect.any(String),
      },
    ];

    const result = updateToolBlockInMessage({
      messages: initialMessages,
      id: toolBlockId,
      parameters: '{"key": "val"}',
      result: "final result",
      shortResult: "short",
      startLineNumber: 10,
      images: [{ data: "base64", mediaType: "image/png" }],
      success: true,
      error: "no error",
      stage: "end",
      compactParams: "compact",
      parametersChunk: "chunk",
      isManuallyBackgrounded: true,
    });

    const block = result[0].blocks[0];
    expect(block).toMatchObject({
      parameters: '{"key": "val"}',
      result: "final result",
      shortResult: "short",
      startLineNumber: 10,
      images: [{ data: "base64", mediaType: "image/png" }],
      success: true,
      error: "no error",
      stage: "end",
      compactParams: "compact",
      parametersChunk: "chunk",
      isManuallyBackgrounded: true,
    });
  });
});

describe("cloneMessage", () => {
  it("should clone a basic message", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      blocks: [{ type: "text", content: "Hello" }],
      timestamp: expect.any(String),
    };
    const cloned = cloneMessage(message);
    expect(cloned).toEqual(message);
    expect(cloned).not.toBe(message);
    expect(cloned.blocks).not.toBe(message.blocks);
  });

  it("should deep clone tool block images", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      blocks: [
        {
          type: "tool",
          id: "tool-1",
          stage: "end",
          images: [{ data: "img1", mediaType: "image/png" }],
        },
      ],
      timestamp: expect.any(String),
    };
    const cloned = cloneMessage(message);
    const originalToolBlock = message.blocks[0] as ToolBlock;
    const clonedToolBlock = cloned.blocks[0] as ToolBlock;
    expect(clonedToolBlock.images).not.toBe(originalToolBlock.images);
    expect(clonedToolBlock.images![0]).not.toBe(originalToolBlock.images![0]);
    expect(clonedToolBlock.images![0]).toEqual(originalToolBlock.images![0]);
  });

  it("should clone additionalFields", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      blocks: [],
      additionalFields: { foo: "bar" },
      timestamp: expect.any(String),
    };
    const cloned = cloneMessage(message);
    expect(cloned.additionalFields).not.toBe(message.additionalFields);
    expect(cloned.additionalFields).toEqual(message.additionalFields);
  });

  it("should handle image blocks", () => {
    const message: Message = {
      id: "msg-1",
      role: "user",
      blocks: [{ type: "image", imageUrls: ["url1"] }],
      timestamp: expect.any(String),
    };
    const cloned = cloneMessage(message);
    const originalBlock = message.blocks[0] as ImageBlock;
    const clonedBlock = cloned.blocks[0] as ImageBlock;
    expect(clonedBlock.imageUrls).not.toBe(originalBlock.imageUrls);
    expect(clonedBlock.imageUrls).toEqual(originalBlock.imageUrls);
  });

  it("should handle file_history blocks", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      timestamp: expect.any(String),
      blocks: [
        {
          type: "file_history",
          snapshots: [
            {
              filePath: "test.ts",
              messageId: "msg-1",
              timestamp: Date.now(),
              operation: "modify",
            },
          ],
        },
      ],
    };
    const cloned = cloneMessage(message);
    const originalBlock = message.blocks[0] as FileHistoryBlock;
    const clonedBlock = cloned.blocks[0] as FileHistoryBlock;
    expect(clonedBlock.snapshots).not.toBe(originalBlock.snapshots);
    expect(clonedBlock.snapshots[0]).not.toBe(originalBlock.snapshots[0]);
    expect(clonedBlock.snapshots[0]).toEqual(originalBlock.snapshots[0]);
  });
});

describe("getMessageContent", () => {
  it("should extract text content", () => {
    const message: Message = {
      id: "msg-1",
      role: "user",
      blocks: [{ type: "text", content: "hello world" }],
      timestamp: expect.any(String),
    };
    expect(getMessageContent(message)).toBe("hello world");
  });

  it("should extract bang command", () => {
    const message: Message = {
      id: "msg-1",
      role: "user",
      blocks: [
        {
          type: "bang",
          command: "ls -la",
          output: "",
          stage: "running",
          exitCode: null,
        },
      ],
      timestamp: expect.any(String),
    };
    expect(getMessageContent(message)).toBe("!ls -la");
  });

  it("should extract compact block content", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      blocks: [
        {
          type: "compact",
          content: "summarized context",
          sessionId: "test-session",
        },
      ],
      timestamp: expect.any(String),
    };
    expect(getMessageContent(message)).toBe("summarized context");
  });

  it("should return empty string if no content block found", () => {
    const message: Message = {
      id: "msg-1",
      role: "assistant",
      blocks: [
        { type: "tool", name: "test", parameters: "{}", stage: "start" },
      ],
      timestamp: expect.any(String),
    };
    expect(getMessageContent(message)).toBe("");
  });
});
