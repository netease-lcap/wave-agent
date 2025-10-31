import { describe, it, expect } from "vitest";
import { todoWriteTool } from "@/tools/todoWriteTool.js";
import type { ToolContext } from "@/tools/types.js";

const mockContext: ToolContext = {
  workdir: "/test/workdir",
  abortSignal: new AbortController().signal,
};

describe("todoWriteTool", () => {
  it("should have correct tool configuration", () => {
    expect(todoWriteTool.name).toBe("TodoWrite");
    expect(todoWriteTool.config.function.name).toBe("TodoWrite");
    expect(todoWriteTool.config.function.description).toContain(
      "Use this tool to create and manage a structured task list",
    );
    expect(todoWriteTool.config.type).toBe("function");

    // Type guard to access function properties
    if (todoWriteTool.config.type === "function") {
      expect(todoWriteTool.config.function.name).toBe("TodoWrite");
      if (todoWriteTool.config.function.parameters) {
        expect(todoWriteTool.config.function.parameters.required).toEqual([
          "todos",
        ]);
      }
    }
  });

  it("should successfully handle empty todo list", async () => {
    const args = { todos: [] };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Todo list updated: 0/0 completed");
    expect(result.shortResult).toBe("0/0 done");
  });

  it("should successfully handle valid todo list", async () => {
    const args = {
      todos: [
        {
          id: "1",
          content: "Write tests",
          status: "completed" as const,
        },
        {
          id: "2",
          content: "Fix linting errors",
          status: "in_progress" as const,
        },
        {
          id: "3",
          content: "Deploy to production",
          status: "pending" as const,
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Todo list updated: 1/3 completed");
    expect(result.shortResult).toBe(
      "1/3 done\n[>] Fix linting errors\n[ ] Deploy to production",
    );
  });

  it("should reject invalid todos parameter", async () => {
    const args = { todos: "invalid" };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("todos parameter must be an array");
    expect(result.shortResult).toBe("Invalid todos format");
  });

  it("should reject missing todos parameter", async () => {
    const args = {};

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("todos parameter must be an array");
    expect(result.shortResult).toBe("Invalid todos format");
  });

  it("should reject invalid todo item", async () => {
    const args = { todos: [null] };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Todo item at index 0 must be an object");
    expect(result.shortResult).toBe("Invalid todo item");
  });

  it("should reject todo item with empty content", async () => {
    const args = {
      todos: [
        {
          id: "1",
          content: "",
          status: "pending",
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Todo item at index 0 must have non-empty content",
    );
    expect(result.shortResult).toBe("Invalid todo content");
  });

  it("should reject todo item with invalid status", async () => {
    const args = {
      todos: [
        {
          id: "1",
          content: "Test task",
          status: "invalid_status",
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Todo item at index 0 has invalid status: invalid_status",
    );
    expect(result.shortResult).toBe("Invalid todo status");
  });

  it("should reject todo item with empty id", async () => {
    const args = {
      todos: [
        {
          id: "",
          content: "Test task",
          status: "pending",
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Todo item at index 0 must have a non-empty id");
    expect(result.shortResult).toBe("Invalid todo id");
  });

  it("should reject duplicate todo IDs", async () => {
    const args = {
      todos: [
        {
          id: "1",
          content: "First task",
          status: "pending" as const,
        },
        {
          id: "1",
          content: "Second task",
          status: "pending" as const,
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Duplicate todo IDs found: 1");
    expect(result.shortResult).toBe("Duplicate todo IDs");
  });

  it("should reject multiple in_progress todos", async () => {
    const args = {
      todos: [
        {
          id: "1",
          content: "First task",
          status: "in_progress" as const,
        },
        {
          id: "2",
          content: "Second task",
          status: "in_progress" as const,
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Only one todo can be in_progress at a time. Found 2 in_progress todos",
    );
    expect(result.shortResult).toBe("Multiple in_progress todos");
  });

  it("should allow one in_progress todo", async () => {
    const args = {
      todos: [
        {
          id: "1",
          content: "Active task",
          status: "in_progress" as const,
        },
        {
          id: "2",
          content: "Pending task",
          status: "pending" as const,
        },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Todo list updated: 0/2 completed");
    expect(result.shortResult).toBe(
      "0/2 done\n[>] Active task\n[ ] Pending task",
    );
  });

  it("should calculate progress correctly", async () => {
    const args = {
      todos: [
        { id: "1", content: "Task 1", status: "completed" as const },
        { id: "2", content: "Task 2", status: "completed" as const },
        { id: "3", content: "Task 3", status: "pending" as const },
        { id: "4", content: "Task 4", status: "pending" as const },
      ],
    };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Todo list updated: 2/4 completed");
    expect(result.shortResult).toBe("2/4 done\n[ ] Task 3 +1");
  });

  it("should validate todo items thoroughly", async () => {
    // Test with null id which should trigger validation error
    const args = { todos: [{ id: null, content: "test", status: "pending" }] };

    const result = await todoWriteTool.execute(args, mockContext);

    expect(result.success).toBe(false);
    expect(result.shortResult).toBe("Invalid todo id");
    expect(result.error).toContain("must have a non-empty id");
  });
});
