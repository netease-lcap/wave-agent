import { describe, it, expect } from "vitest";
import { addMemoryBlockToMessage } from "@/utils/messageOperations.js";
import type { Message } from "@/types.js";

describe("Memory Display Fixes", () => {
  it("should add memory block with correct storage path for project memory", () => {
    const messages: Message[] = [];

    const result = addMemoryBlockToMessage({
      messages,
      content: "项目记忆: test memory content",
      isSuccess: true,
      memoryType: "project",
      storagePath: "LCAP.md",
    });

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks[0].type).toBe("memory");

    const memoryBlock = result[0].blocks[0];
    if (memoryBlock.type === "memory") {
      expect(memoryBlock.content).toBe("项目记忆: test memory content");
      expect(memoryBlock.isSuccess).toBe(true);
      expect(memoryBlock.memoryType).toBe("project");
      expect(memoryBlock.storagePath).toBe("LCAP.md");
    }
  });

  it("should add memory block with correct storage path for user memory", () => {
    const messages: Message[] = [];

    const result = addMemoryBlockToMessage({
      messages,
      content: "用户记忆: user preference",
      isSuccess: true,
      memoryType: "user",
      storagePath: "user-memory.md",
    });

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].blocks).toHaveLength(1);
    expect(result[0].blocks[0].type).toBe("memory");

    const memoryBlock = result[0].blocks[0];
    if (memoryBlock.type === "memory") {
      expect(memoryBlock.content).toBe("用户记忆: user preference");
      expect(memoryBlock.isSuccess).toBe(true);
      expect(memoryBlock.memoryType).toBe("user");
      expect(memoryBlock.storagePath).toBe("user-memory.md");
    }
  });

  it("should handle failed memory operations with correct type information", () => {
    const messages: Message[] = [];

    const result = addMemoryBlockToMessage({
      messages,
      content: "用户记忆添加失败: Permission denied",
      isSuccess: false,
      memoryType: "user",
      storagePath: "user-memory.md",
    });

    expect(result).toHaveLength(1);

    const memoryBlock = result[0].blocks[0];
    if (memoryBlock.type === "memory") {
      expect(memoryBlock.content).toBe("用户记忆添加失败: Permission denied");
      expect(memoryBlock.isSuccess).toBe(false);
      expect(memoryBlock.memoryType).toBe("user");
      expect(memoryBlock.storagePath).toBe("user-memory.md");
    }
  });
});
