import React, { forwardRef, useImperativeHandle } from "react";
import { Box, Text } from "ink";

interface HookTesterProps<T> {
  hook: () => T;
  children?: (result: T) => React.ReactNode;
}

export interface HookTesterRef<T> {
  getState: () => T;
  getCurrentState: () => T; // Alias, clearer naming
}

/**
 * Generic Hook testing component
 * Uses useImperativeHandle to expose hook state to tests
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

  // Default render: show component is under test
  return (
    <Box flexDirection="column">
      <Text>Hook Tester Active</Text>
    </Box>
  );
});

HookTester.displayName = "HookTester";
