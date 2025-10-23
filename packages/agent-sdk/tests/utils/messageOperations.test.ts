import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  convertImageToBase64,
  addMemoryBlockToMessage,
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
  addUserMessageToMessages,
} from "@/utils/messageOperations.js";
import type { Message } from "@/types.js";

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
  let tempImagePath: string;

  beforeEach(() => {
    // Create a temporary PNG image file for testing
    // This is binary data for a 1x1 pixel transparent PNG
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    tempImagePath = join(tmpdir(), `test-image-${Date.now()}.png`);
    writeFileSync(tempImagePath, pngBuffer);
  });

  afterEach(() => {
    // Clean up temporary file
    if (existsSync(tempImagePath)) {
      try {
        unlinkSync(tempImagePath);
      } catch {
        // Failed to cleanup temp file - ignore error in tests
      }
    }
  });

  it("should convert PNG image to base64 data URL", () => {
    const result = convertImageToBase64(tempImagePath);

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(result.length).toBeGreaterThan("data:image/png;base64,".length);
  });

  it("should handle JPEG files with correct MIME type", () => {
    const jpegPath = tempImagePath.replace(".png", ".jpg");
    // Copy file and rename to .jpg
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    writeFileSync(jpegPath, pngBuffer);

    const result = convertImageToBase64(jpegPath);

    expect(result).toMatch(/^data:image\/jpeg;base64,/);

    // Clean up temporary JPEG file
    if (existsSync(jpegPath)) {
      unlinkSync(jpegPath);
    }
  });

  it("should handle non-existent files gracefully", () => {
    const nonExistentPath = "/tmp/non-existent-image.png";

    const result = convertImageToBase64(nonExistentPath);

    // Should return empty base64 placeholder instead of throwing error
    expect(result).toBe("data:image/png;base64,");
  });

  it("should handle files with unknown extensions", () => {
    const unknownExtPath = tempImagePath.replace(".png", ".unknown");
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    writeFileSync(unknownExtPath, pngBuffer);

    const result = convertImageToBase64(unknownExtPath);

    // Should default to PNG MIME type
    expect(result).toMatch(/^data:image\/png;base64,/);

    // Clean up temporary file
    if (existsSync(unknownExtPath)) {
      unlinkSync(unknownExtPath);
    }
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
