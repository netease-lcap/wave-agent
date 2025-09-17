import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { MessageList } from "@/components/MessageList";
import type { Message } from "@/types";

describe("MessageList Image Display", () => {
  it("should display '📷 Image (1)' for message with single image", () => {
    // Create a message with single image block
    const messagesWithImage: Message[] = [
      {
        role: "user",
        blocks: [
          { type: "text", content: "Look at this image" },
          {
            type: "image",
            attributes: {
              imageUrls: ["/tmp/test-image.png"],
            },
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <MessageList messages={messagesWithImage} isLoading={false} />,
    );

    const output = lastFrame();

    // Should display the image indicator with count
    expect(output).toContain("📷 Image (1)");
    expect(output).toContain("Look at this image");
  });

  it("should display '📷 Image (2)' for message with multiple images", () => {
    // Create a message with multiple image blocks
    const messagesWithImages: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "image",
            attributes: {
              imageUrls: ["/tmp/test-image1.png", "/tmp/test-image2.jpg"],
            },
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <MessageList messages={messagesWithImages} isLoading={false} />,
    );

    const output = lastFrame();

    // Should display the image indicator with count of 2
    expect(output).toContain("📷 Image (2)");
  });

  it("should display '📷 Image' without count for empty image block", () => {
    // Create a message with image block but no imageUrls
    const messagesWithEmptyImage: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "image",
            attributes: {},
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <MessageList messages={messagesWithEmptyImage} isLoading={false} />,
    );

    const output = lastFrame();

    // Should display just the image indicator without count
    expect(output).toContain("📷 Image");
    expect(output).not.toContain("📷 Image (");
  });

  it("should display image-only message correctly", () => {
    // Create a message with only image, no text
    const imageOnlyMessage: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "image",
            attributes: {
              imageUrls: ["/tmp/test-image.png"],
            },
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <MessageList messages={imageOnlyMessage} isLoading={false} />,
    );

    const output = lastFrame();

    // Should display the image indicator
    expect(output).toContain("📷 Image (1)");
    // Should show user header
    expect(output).toContain("👤 You");
  });
});
