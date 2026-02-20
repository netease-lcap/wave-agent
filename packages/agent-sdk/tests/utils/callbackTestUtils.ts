/**
 * @file Test utilities for callback verification
 * Provides helper functions for testing subagent callback functionality
 */

import { vi, expect } from "vitest";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";

/**
 * Creates mock callbacks for testing subagent functionality
 */
export function createMockCallbacks(): MessageManagerCallbacks {
  return {
    onMessagesChange: vi.fn(),
    onSessionIdChange: vi.fn(),
    onLatestTotalTokensChange: vi.fn(),
    onUsagesChange: vi.fn(),
    onUserMessageAdded: vi.fn(),
    onAssistantMessageAdded: vi.fn(),
    onAssistantContentUpdated: vi.fn(),
    onToolBlockUpdated: vi.fn(),
    onErrorBlockAdded: vi.fn(),
    onCompressBlockAdded: vi.fn(),
    onCompressionStateChange: vi.fn(),
    onMemoryBlockAdded: vi.fn(),
    onAddCommandOutputMessage: vi.fn(),
    onUpdateCommandOutputMessage: vi.fn(),
    onCompleteCommandMessage: vi.fn(),
    // Note: Subagent-specific callbacks have been moved to SubagentManagerCallbacks
  };
}

/**
 * Creates mock callbacks with error-throwing implementations for testing error handling
 */
export function createErrorThrowingCallbacks(): MessageManagerCallbacks {
  const errorCallback = vi.fn().mockImplementation(() => {
    throw new Error("Mock callback error");
  });

  return {
    onMessagesChange: errorCallback,
    onUserMessageAdded: errorCallback,
    onAssistantMessageAdded: errorCallback,
    onAssistantContentUpdated: errorCallback,
    onToolBlockUpdated: errorCallback,
    // Note: Subagent-specific error callbacks have been moved to SubagentManagerCallbacks
  };
}

/**
 * Verifies that a callback was called with expected parameters
 */
export function verifyCallbackCalled(
  callback: ReturnType<typeof vi.fn>,
  expectedParams?: unknown[],
) {
  expect(callback).toHaveBeenCalled();
  if (expectedParams) {
    expect(callback).toHaveBeenCalledWith(...expectedParams);
  }
}

/**
 * Verifies that a callback was NOT called
 */
export function verifyCallbackNotCalled(callback: ReturnType<typeof vi.fn>) {
  expect(callback).not.toHaveBeenCalled();
}

/**
 * Verifies callback call count
 */
export function verifyCallbackCallCount(
  callback: ReturnType<typeof vi.fn>,
  expectedCount: number,
) {
  expect(callback).toHaveBeenCalledTimes(expectedCount);
}

/**
 * Resets all mocks in a callback object
 */
export function resetAllCallbacks(callbacks: MessageManagerCallbacks) {
  Object.values(callbacks).forEach((callback) => {
    if (callback && typeof callback === "function" && "mockReset" in callback) {
      (callback as ReturnType<typeof vi.fn>).mockReset();
    }
  });
}

/**
 * Creates a test context with common setup for callback testing
 */
export interface CallbackTestContext {
  mockCallbacks: MessageManagerCallbacks;
  resetCallbacks: () => void;
  verifyCallback: (
    name: keyof MessageManagerCallbacks,
    expectedParams?: unknown[],
  ) => void;
  verifyCallbackNotCalled: (name: keyof MessageManagerCallbacks) => void;
}

export function createCallbackTestContext(): CallbackTestContext {
  const mockCallbacks = createMockCallbacks();

  return {
    mockCallbacks,
    resetCallbacks: () => resetAllCallbacks(mockCallbacks),
    verifyCallback: (
      name: keyof MessageManagerCallbacks,
      expectedParams?: unknown[],
    ) => {
      const callback = mockCallbacks[name];
      if (callback) {
        verifyCallbackCalled(
          callback as ReturnType<typeof vi.fn>,
          expectedParams,
        );
      }
    },
    verifyCallbackNotCalled: (name: keyof MessageManagerCallbacks) => {
      const callback = mockCallbacks[name];
      if (callback) {
        verifyCallbackNotCalled(callback as ReturnType<typeof vi.fn>);
      }
    },
  };
}

// Add subagent-specific test utilities after T004:
// - createMockSubagentCallbacks()
// - verifySubagentCallback()
// - createSubagentTestContext()

/**
 * Creates mock callbacks specifically for subagent callback testing
 */
export function createMockSubagentCallbacks(): SubagentManagerCallbacks {
  return {
    onSubagentUserMessageAdded: vi.fn(),
    onSubagentAssistantMessageAdded: vi.fn(),
    onSubagentAssistantContentUpdated: vi.fn(),
    onSubagentToolBlockUpdated: vi.fn(),
  };
}

/**
 * Creates error-throwing subagent callbacks for testing error handling
 */
export function createErrorThrowingSubagentCallbacks(): SubagentManagerCallbacks {
  const errorCallback = vi.fn().mockImplementation(() => {
    throw new Error("Mock subagent callback error");
  });

  return {
    onSubagentUserMessageAdded: errorCallback,
    onSubagentAssistantMessageAdded: errorCallback,
    onSubagentAssistantContentUpdated: errorCallback,
    onSubagentToolBlockUpdated: errorCallback,
  };
}

/**
 * Verifies a subagent-specific callback was called correctly
 */
export function verifySubagentCallback(
  callback: ReturnType<typeof vi.fn>,
  subagentId: string,
  ...additionalParams: unknown[]
) {
  expect(callback).toHaveBeenCalledWith(subagentId, ...additionalParams);
}

/**
 * Creates a test context specifically for subagent callback testing
 */
export function createSubagentCallbackTestContext(): {
  mockCallbacks: SubagentManagerCallbacks;
  verifyCallback: (
    name: keyof SubagentManagerCallbacks,
    subagentId: string,
    ...params: unknown[]
  ) => void;
} {
  const mockCallbacks = createMockSubagentCallbacks();

  return {
    mockCallbacks,
    verifyCallback: (name, subagentId, ...params) => {
      const callback = mockCallbacks[name];
      if (callback) {
        verifySubagentCallback(
          callback as ReturnType<typeof vi.fn>,
          subagentId,
          ...params,
        );
      }
    },
  };
}

/**
 * Test constants for subagent callback testing
 */
export const SUBAGENT_TEST_CONSTANTS = {
  MOCK_SUBAGENT_ID: "test-subagent-123",
  MOCK_USER_MESSAGE: "Test user message from subagent",
  MOCK_ASSISTANT_CHUNK: "Response chunk",
  MOCK_ASSISTANT_ACCUMULATED: "Full response content",
  MOCK_TOOL_NAME: "testTool",
  MOCK_TOOL_PARAMS: '{"param": "value"}',
  MOCK_TOOL_RESULT: "Tool executed successfully",
} as const;
