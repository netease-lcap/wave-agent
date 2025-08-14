import { describe, it, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import React from "react";
import { App } from "../src/components/App";
import { waitForText } from "./utils/aiWaitHelpers";

// 不使用完整的context mock，让真实的命令执行逻辑运行

describe("Echo Command Debug Test", () => {
  let testDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "echo-debug-test-"),
    );
  });

  afterEach(async () => {
    // 清理测试目录
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it("should debug echo command execution", async () => {
    // 渲染 App 组件
    const renderResult = render(<App workdir={testDir} />);
    const { stdin, lastFrame } = renderResult;

    // 等待组件完全渲染，确保初始状态显示
    await waitForText(renderResult, "Type your message", { timeout: 3000 });

    console.log("=== Initial State ===");
    console.log(lastFrame());

    // 逐个字符输入 !echo 'hi'
    const input = "!echo 'hi'";
    for (const char of input) {
      stdin.write(char);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // 等待完整输入显示
    await waitForText(renderResult, "!echo 'hi'", { timeout: 3000 });

    console.log("=== After Input ===");
    console.log(lastFrame());

    // 第一次按回车 - 进入bash历史选择器模式
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("=== After First Enter ===");
    console.log(lastFrame());

    // 第二次按回车 - 确认执行命令
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("=== After Second Enter ===");
    console.log(lastFrame());

    // 等待更长时间看命令执行
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("=== After Wait ===");
    console.log(lastFrame());

    // 验证最终输出
    const finalOutput = lastFrame();
    console.log("=== Final Output ===");
    console.log(finalOutput);

    // 验证是否包含成功标记
    if (finalOutput && finalOutput.includes("Success")) {
      console.log("✅ Found Success marker");
    } else {
      console.log("❌ No Success marker found");
    }

    // 验证是否包含命令输出
    if (finalOutput && finalOutput.includes("hi")) {
      console.log("✅ Found command output");
    } else {
      console.log("❌ No command output found");
    }
  }, 15000); // 增加测试超时时间
});
