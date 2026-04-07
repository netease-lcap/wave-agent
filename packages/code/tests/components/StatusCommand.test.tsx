import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { StatusCommand } from "../../src/components/StatusCommand.js";
import { useChat } from "../../src/contexts/useChat.js";
import { stripAnsiColors } from "wave-agent-sdk";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("StatusCommand", () => {
  const mockChatContext = {
    sessionId: "test-session-id",
    workingDirectory: "/test/cwd",
    getGatewayConfig: vi.fn().mockReturnValue({ baseURL: "https://test.api" }),
    getModelConfig: vi.fn().mockReturnValue({
      model: "test-model",
      fastModel: "test-fast-model",
    }),
  };

  beforeEach(() => {
    vi.mocked(useChat).mockReturnValue(
      mockChatContext as unknown as ReturnType<typeof useChat>,
    );
  });

  it("should render status information", () => {
    const { lastFrame } = render(<StatusCommand onCancel={() => {}} />);
    const output = stripAnsiColors(lastFrame() || "");

    expect(output).toContain("Agent Status");
    expect(output).toContain("Version:");
    expect(output).toContain("Session ID:");
    expect(output).toContain("test-session-id");
    expect(output).toContain("cwd:");
    expect(output).toContain("/test/cwd");
    expect(output).toContain("Wave base URL:");
    expect(output).toContain("https://test.api");
    expect(output).toContain("Model:");
    expect(output).toContain("test-model");
    expect(output).toContain("Fast model:");
    expect(output).toContain("test-fast-model");
  });

  it("should call onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<StatusCommand onCancel={onCancel} />);

    stdin.write("\u001b"); // Escape

    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
