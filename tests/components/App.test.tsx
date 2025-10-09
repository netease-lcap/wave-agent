import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { App } from "@/components/App.js";

describe("App Component", () => {
  it("should render the main interface with file count", () => {
    const { lastFrame } = render(<App />);

    expect(lastFrame()).toContain("WAVE Code Assistant");
  });

  it("should render the chat interface", () => {
    const { lastFrame } = render(<App />);

    // ChatInterface 会渲染 MessageList 和 InputBox，这里测试整体渲染
    expect(lastFrame()).toBeTruthy();
    // 可以测试是否包含输入框的边框等UI元素
    expect(lastFrame()).toMatch(/[┌┐└┘│─]/); // 检查是否有边框字符
  });

  it("should wrap components with providers", () => {
    const { lastFrame } = render(<App />);

    // Verify that the component renders without errors
    expect(lastFrame()).toBeTruthy();
  });
});
