import React, { forwardRef, useImperativeHandle } from "react";
import { Box, Text } from "ink";

interface HookTesterProps<T> {
  hook: () => T;
  children?: (result: T) => React.ReactNode;
}

export interface HookTesterRef<T> {
  getState: () => T;
  getCurrentState: () => T; // 别名，更清晰
}

/**
 * 通用的 Hook 测试组件
 * 使用 useImperativeHandle 将 hook 状态暴露给测试
 */
export const HookTester = forwardRef<
  HookTesterRef<unknown>,
  HookTesterProps<unknown>
>(({ hook, children }, ref) => {
  const hookResult = hook();

  useImperativeHandle(ref, () => ({
    getState: () => hookResult,
    getCurrentState: () => hookResult,
  }));

  if (children) {
    return <>{children(hookResult)}</>;
  }

  // 默认渲染：显示组件正在测试
  return (
    <Box flexDirection="column">
      <Text>Hook Tester Active</Text>
    </Box>
  );
});

HookTester.displayName = "HookTester";
