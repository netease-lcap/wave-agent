import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { App } from "../../src/components/App";
import { waitForText } from "../helpers/waitHelpers";

// 使用 vi.hoisted 确保 mock 在模块顶层被正确设置
await vi.hoisted(async () => {
  const { setupFileManagerMock } = await import("../mocks/fileManagerMock");
  setupFileManagerMock();
});

// 不使用完整的context mock，让真实的命令执行逻辑运行

describe("Echo Command Integration Test", () => {
  it("should handle user input '!echo 'hi'' through bash history selector and display command output", async () => {
    // 使用当前项目目录作为 workdir，即使 fileManager 已被 mock
    // 这确保其他依赖于真实目录路径的功能能正常工作
    // 由于 fileManager 被 mock，不会产生实际的文件 I/O 开销
    const mockWorkdir = process.cwd();

    // 渲染 App 组件
    const renderResult = render(<App workdir={mockWorkdir} />);
    const { stdin, lastFrame } = renderResult;

    // 等待组件完全渲染，确保初始状态显示
    await waitForText(renderResult, "Type your message", { timeout: 3000 });

    stdin.write("!echo 'hi'");

    // 等待完整输入显示
    await waitForText(renderResult, "!echo 'hi'", { timeout: 3000 });

    // 按回车
    stdin.write("\r");

    // 等待命令执行成功，增加更长的超时时间
    await waitForText(renderResult, "echo 'hi' ✅", { timeout: 5000 });

    // 验证最终输出
    const finalOutput = lastFrame();

    // 验证输入框已恢复到初始状态
    expect(finalOutput).toContain("Type your message");
  }, 10000); // 增加测试超时时间到10秒
});
