import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/components/App";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testApp() {
  console.log("🧪 开始测试 App 组件");

  try {
    // 渲染 App 组件
    console.log("📦 渲染 App 组件...");
    const { stdin, lastFrame, unmount } = render(<App />);

    // 等待初始渲染完成
    await delay(100);
    console.log("✅ 初始渲染完成");

    // 显示初始状态
    console.log("\n📸 初始界面状态:");
    console.log("=".repeat(60));
    console.log(lastFrame());
    console.log("=".repeat(60));

    // 模拟输入 "hi"
    console.log("\n⌨️ 模拟输入 'hi'...");
    stdin.write("hi");

    // 等待输入处理
    await delay(100);

    // 显示输入后的状态
    console.log("📸 输入 'hi' 后的界面状态:");
    console.log("=".repeat(60));
    console.log(lastFrame());
    console.log("=".repeat(60));

    // 模拟按 Enter 键发送消息
    console.log("\n↵ 模拟按 Enter 键发送消息...");
    stdin.write("\r"); // 回车键

    // 等待消息发送处理
    await delay(200);

    // 显示发送消息后的状态
    console.log("📸 发送消息后的界面状态:");
    console.log("=".repeat(60));
    console.log(lastFrame());
    console.log("=".repeat(60));

    // 再等待一段时间查看可能的 AI 响应
    console.log("\n⏳ 等待 AI 响应...");
    await delay(5000);
    console.log("📸 等待 5 秒后的界面状态:");
    console.log("=".repeat(60));
    console.log(lastFrame());
    console.log("=".repeat(60));

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
