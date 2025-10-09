import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig(() => {
  // 检查是否在 CI 环境中 - 支持多种 CI 环境变量
  const isCI = !!(process.env.CI === "true");

  // 在 CI 环境中输出重试配置信息
  if (isCI) {
    console.log(`🔄 CI environment detected: test retry enabled (2 retries)`);
  }

  return {
    test: {
      globals: true,
      environment: "node",
      include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
      exclude: ["node_modules", "dist"],
      // CI 环境下启用重试：失败的测试最多重试 2 次
      retry: isCI ? 2 : 0,
      // 测试环境变量：默认禁用 logger I/O 操作以提升性能
      env: {
        DISABLE_LOGGER_IO: "true",
        // 设置较短的防抖时间以加速测试
        FILE_SELECTOR_DEBOUNCE_MS: "50",
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
  };
});
