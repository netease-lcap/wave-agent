import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logger } from "../src/utils/logger";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  convertImageToBase64,
  addMemoryBlockToMessage,
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
} from "../src/utils/messageOperations";
import type { Message } from "../src/types";

describe("convertImageToBase64", () => {
  let tempImagePath: string;

  beforeEach(() => {
    // 创建一个临时的PNG图片文件用于测试
    // 这是一个1x1像素透明PNG的二进制数据
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
    // 清理临时文件
    if (existsSync(tempImagePath)) {
      try {
        unlinkSync(tempImagePath);
      } catch {
        logger.warn("Failed to cleanup temp file:", tempImagePath);
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
    // 复制文件并重命名为.jpg
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

    // 清理临时JPEG文件
    if (existsSync(jpegPath)) {
      unlinkSync(jpegPath);
    }
  });

  it("should handle non-existent files gracefully", () => {
    const nonExistentPath = "/tmp/non-existent-image.png";

    const result = convertImageToBase64(nonExistentPath);

    // 应该返回空的base64占位符，而不是抛出错误
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

    // 应该默认使用PNG MIME类型
    expect(result).toMatch(/^data:image\/png;base64,/);

    // 清理临时文件
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

    const result = addMemoryBlockToMessage(
      initialMessages,
      "记住这个重要信息",
      true,
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: "assistant",
      blocks: [
        {
          type: "memory",
          content: "记住这个重要信息",
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

    const result = addMemoryBlockToMessage(
      initialMessages,
      "添加记忆失败: 磁盘空间不足",
      false,
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      role: "assistant",
      blocks: [
        {
          type: "memory",
          content: "添加记忆失败: 磁盘空间不足",
          isSuccess: false,
        },
      ],
    });
  });

  it("should work with empty message list", () => {
    const initialMessages: Message[] = [];

    const result = addMemoryBlockToMessage(initialMessages, "第一个记忆", true);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      blocks: [
        {
          type: "memory",
          content: "第一个记忆",
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

    const result = addMemoryBlockToMessage(initialMessages, "记忆内容", true);

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

      const result = addCommandOutputMessage(initialMessages, "echo hello");

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

      const result = addCommandOutputMessage(initialMessages, "ls -la");

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

      const result = addCommandOutputMessage(initialMessages, "pwd");

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

      const result = updateCommandOutputInMessage(
        initialMessages,
        "echo hello",
        "hello\n",
      );

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

      const result = updateCommandOutputInMessage(
        initialMessages,
        "echo second",
        "second\n",
      );

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

      const result = updateCommandOutputInMessage(
        initialMessages,
        "echo test",
        "  test output  \n",
      );

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

      const result = updateCommandOutputInMessage(
        initialMessages,
        "echo hello",
        "new output",
      );

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

      const result = completeCommandInMessage(initialMessages, "echo hello", 0);

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

      const result = completeCommandInMessage(
        initialMessages,
        "ls /nonexistent",
        1,
      );

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

      const result = completeCommandInMessage(
        initialMessages,
        "echo second",
        0,
      );

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

      const result = completeCommandInMessage(initialMessages, "echo hello", 1);

      // Should not modify because command is not running
      expect(result[0].blocks[0]).toMatchObject({
        isRunning: false,
        exitCode: 0, // Original exit code should remain
      });
    });
  });
});
