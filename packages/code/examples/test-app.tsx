import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App.js";
import {
  waitForText,
  waitForTextToDisappear,
} from "../tests/helpers/waitHelpers.js";

// 延迟函数，作为 waitHelper 的补充
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testApp() {
  console.log("🧪 开始测试 App 组件");

  try {
    // 渲染 App 组件
    console.log("📦 渲染 App 组件...");
    const { stdin, lastFrame, unmount } = render(<App />);

    // 等待初始渲染完成 - 等待欢迎消息出现
    console.log("⏳ 等待初始渲染完成...");
    await waitForText(lastFrame, "Welcome to WAVE Code Assistant!");
    console.log("✅ 初始渲染完成");

    // 显示初始状态
    console.log("\n📸 初始界面状态:");
    console.log(lastFrame());

    // 模拟输入 "hi"
    console.log("\n⌨️ 模拟输入 'hi'...");
    stdin.write("hi");

    // 等待输入处理
    await delay(50); // 基础延迟确保输入被处理

    // 显示输入后的状态
    console.log("📸 输入 'hi' 后的界面状态:");
    console.log(lastFrame());

    // 模拟按 Enter 键发送消息
    console.log("\n↵ 模拟按 Enter 键发送消息...");
    stdin.write("\r"); // 回车键

    // 显示发送消息后的状态
    console.log("📸 发送消息后的界面状态:");
    console.log(lastFrame());

    console.log("✅ 用户消息已发送");

    // 等待 AI 开始思考
    console.log("⏳ 等待 AI 开始思考...");
    await waitForText(lastFrame, "AI is thinking");

    // 等待 AI 响应完成
    console.log("⏳ 等待 AI 响应...");
    await waitForTextToDisappear(lastFrame, "AI is thinking", {
      timeout: 20 * 1000,
    });
    console.log("✅ AI 已响应！");
    console.log("📸 AI 响应后的界面状态:");
    console.log(lastFrame());

    // 清理资源
    unmount();
    console.log("\n✨ 测试完成！");
  } catch (error) {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  }
}

// 添加错误处理
process.on("unhandledRejection", (reason, promise) => {
  console.error("未处理的 Promise 拒绝:", promise, "原因:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("未捕获的异常:", error);
  process.exit(1);
});

// 运行测试
testApp().catch((error) => {
  console.error("❌ 运行测试时发生错误:", error);
  process.exit(1);
});
