import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Message } from "wave-agent-sdk";

// Mock useInput to prevent key handling during tests
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("MessageList Component", () => {
  const createMessage = (
    role: "user" | "assistant",
    content: string,
    id: number,
  ): Message => ({
    id: `msg-${id}`,
    role,
    blocks: [
      {
        type: "text",
        content: `${content} - Message ${id}`,
      },
    ],
    timestamp: new Date().toISOString(),
  });

  beforeEach(() => {
    // Clear any potential state
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
  });

  describe("Welcome message", () => {
    it("should display welcome message when no messages", () => {
      const { lastFrame } = render(
        <MessageList messages={[]} isExpanded={false} />,
      );

      expect(lastFrame()).toContain("WAVE");
    });

    it("should display welcome message even when messages are present", () => {
      const messages = [createMessage("user", "Hello", 1)];
      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      expect(lastFrame()).toContain("WAVE");
      expect(lastFrame()).toContain("Hello - Message 1");
    });

    it("should display version and workdir in welcome message", () => {
      const { lastFrame } = render(
        <MessageList
          messages={[]}
          isExpanded={false}
          version="1.2.3"
          workdir="/test/dir"
        />,
      );

      const output = lastFrame();
      expect(output).toContain("WAVE v1.2.3");
      expect(output).toContain("/test/dir");
    });
  });

  describe("Basic message rendering", () => {
    it("should render a single message", () => {
      const messages = [createMessage("user", "Hello", 1)];
      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      expect(lastFrame()).toContain("Hello - Message 1");
    });

    it("should render multiple messages", () => {
      const messages = [
        createMessage("user", "Hello", 1),
        createMessage("assistant", "Hi there", 2),
      ];
      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      expect(lastFrame()).toContain("Hello - Message 1");
      expect(lastFrame()).toContain("Hi there - Message 2");
    });

    it("should render error blocks", () => {
      const messages: Message[] = [
        {
          id: "msg-error",
          role: "assistant",
          blocks: [{ type: "error", content: "Something went wrong" }],
          timestamp: new Date().toISOString(),
        },
      ];
      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      expect(lastFrame()).toContain("Error: Something went wrong");
    });

    it("should render messages correctly", () => {
      const messages = [
        createMessage("user", "First", 1),
        createMessage("assistant", "Second", 2),
      ];
      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      expect(lastFrame()).toContain("First - Message 1");
      expect(lastFrame()).toContain("Second - Message 2");
    });
  });

  describe("Image display", () => {
    it("should display '# Image (1)' for message with single image", () => {
      // Create a message with single image block
      const messagesWithImage: Message[] = [
        {
          id: "msg-image-1",
          role: "user",
          blocks: [
            { type: "text", content: "Look at this image" },
            {
              type: "image",
              imageUrls: ["/tmp/test-image.png"],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const { lastFrame } = render(
        <MessageList messages={messagesWithImage} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should display the image indicator with count
      expect(output).toContain("# Image (1)");
      expect(output).toContain("Look at this image");
    });

    it("should display '# Image (2)' for message with multiple images", () => {
      // Create a message with multiple image blocks
      const messagesWithImages: Message[] = [
        {
          id: "msg-image-2",
          role: "user",
          blocks: [
            {
              type: "image",
              imageUrls: ["/tmp/test-image1.png", "/tmp/test-image2.jpg"],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const { lastFrame } = render(
        <MessageList messages={messagesWithImages} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should display the image indicator with count of 2
      expect(output).toContain("# Image (2)");
    });

    it("should display '# Image' without count for empty image block", () => {
      // Create a message with image block but no imageUrls
      const messagesWithEmptyImage: Message[] = [
        {
          id: "msg-image-empty",
          role: "user",
          blocks: [
            {
              type: "image",
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const { lastFrame } = render(
        <MessageList messages={messagesWithEmptyImage} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should display just the image indicator without count
      expect(output).toContain("# Image");
      expect(output).not.toContain("# Image (");
    });

    it("should display image-only message correctly", () => {
      // Create a message with only image, no text
      const imageOnlyMessage: Message[] = [
        {
          id: "msg-image-only",
          role: "user",
          blocks: [
            {
              type: "image",
              imageUrls: ["/tmp/test-image.png"],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const { lastFrame } = render(
        <MessageList messages={imageOnlyMessage} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should display the image indicator
      expect(output).toContain("# Image (1)");
    });
  });

  describe("Reasoning block rendering", () => {
    it("should display reasoning block correctly", () => {
      const messagesWithReasoning: Message[] = [
        {
          id: "msg-reasoning",
          role: "assistant",
          blocks: [
            {
              type: "text",
              content: "Let me think about this problem.",
            },
            {
              type: "reasoning",
              content:
                "**Analyzing the Request**\n\nThe user is asking for help with a complex problem. I need to break this down step by step.",
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const { lastFrame } = render(
        <MessageList messages={messagesWithReasoning} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should display the text content
      expect(output).toContain("Let me think about this problem");

      // Should display reasoning content
      expect(output).toContain("Analyzing the Request");
      expect(output).toContain("The user is asking for help");
    });

    it("should not display empty reasoning blocks", () => {
      const messagesWithEmptyReasoning: Message[] = [
        {
          id: "msg-empty-reasoning",
          role: "assistant",
          blocks: [
            {
              type: "text",
              content: "Hello there!",
            },
            {
              type: "reasoning",
              content: "",
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const { lastFrame } = render(
        <MessageList
          messages={messagesWithEmptyReasoning}
          isExpanded={false}
        />,
      );

      const output = lastFrame();

      // Should display text content
      expect(output).toContain("Hello there!");
    });
  });
});
