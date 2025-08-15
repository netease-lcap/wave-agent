import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import React from "react";
import { App } from "../../src/components/App";
import { waitForText } from "../helpers/waitHelpers";

// 不使用完整的context mock，让真实的命令执行逻辑运行

describe("Echo Command Integration Test", () => {
  let testDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "echo-command-test-"),
    );
  });

  afterEach(async () => {
    // 清理测试目录
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it("should handle user input '!echo 'hi'' through bash history selector and display command output", async () => {
    // 渲染 App 组件
    const renderResult = render(<App workdir={testDir} />);
    const { stdin, lastFrame } = renderResult;

    // 等待组件完全渲染，确保初始状态显示
    await waitForText(renderResult, "Type your message", { timeout: 3000 });

    // 逐个字符输入 !echo 'hi'
    const input = "!echo 'hi'";
    for (const char of input) {
      stdin.write(char);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // 等待完整输入显示
    await waitForText(renderResult, "!echo 'hi'", { timeout: 3000 });

    // 验证用户输入显示在界面上，并且显示了bash历史选择器
    const currentOutput = lastFrame();
    expect(currentOutput).toContain("!echo 'hi'");
    expect(currentOutput).toContain("Press Enter to execute: echo 'hi'");

    // 第一次按回车 - 进入bash历史选择器模式
    stdin.write("\r");
    // 短暂等待让bash历史选择器状态切换完成
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 第二次按回车 - 确认执行命令
    stdin.write("\r");
    // 短暂等待让命令执行状态切换完成
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 等待命令执行成功，增加更长的超时时间
    await waitForText(renderResult, "echo 'hi' ✅", { timeout: 5000 });

    // 验证最终输出
    const finalOutput = lastFrame();

    // 验证命令执行成功
    expect(finalOutput).toContain("echo 'hi' ✅");

    // 验证命令输出显示
    expect(finalOutput).toContain("hi");

    // 验证输入框已恢复到初始状态
    expect(finalOutput).toContain("Type your message");
  }, 10000); // 增加测试超时时间到10秒
});
