import type { PermissionDecision } from "wave-agent-sdk";

export interface ConfirmQueueItem {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  planContent?: string;
  resolver: (decision: PermissionDecision) => void;
  reject: () => void;
}

export interface ConfirmingTool {
  name: string;
  input?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  planContent?: string;
}

export interface ConfirmState {
  queue: ConfirmQueueItem[];
  current: ConfirmQueueItem | null;
  isVisible: boolean;
  tool: ConfirmingTool | undefined;
}

export type ConfirmAction =
  | { type: "QUEUE"; item: ConfirmQueueItem }
  | { type: "PROCESS_NEXT" }
  | { type: "DECIDE"; decision: PermissionDecision }
  | { type: "CANCEL" }
  | { type: "HIDE" };

export const initialConfirmState: ConfirmState = {
  queue: [],
  current: null,
  isVisible: false,
  tool: undefined,
};

export function confirmReducer(
  state: ConfirmState,
  action: ConfirmAction,
): ConfirmState {
  switch (action.type) {
    case "QUEUE": {
      // If no current item and not visible, process immediately
      if (!state.current && !state.isVisible) {
        return {
          ...state,
          current: action.item,
          tool: {
            name: action.item.toolName,
            input: action.item.toolInput,
            suggestedPrefix: action.item.suggestedPrefix,
            hidePersistentOption: action.item.hidePersistentOption,
            planContent: action.item.planContent,
          },
          isVisible: true,
        };
      }
      // Otherwise add to queue
      return {
        ...state,
        queue: [...state.queue, action.item],
      };
    }
    case "PROCESS_NEXT": {
      if (state.queue.length > 0) {
        const [next, ...remaining] = state.queue;
        return {
          ...state,
          current: next,
          tool: {
            name: next.toolName,
            input: next.toolInput,
            suggestedPrefix: next.suggestedPrefix,
            hidePersistentOption: next.hidePersistentOption,
            planContent: next.planContent,
          },
          isVisible: true,
          queue: remaining,
        };
      }
      // Clear everything if queue is empty
      return {
        ...state,
        current: null,
        tool: undefined,
        isVisible: false,
      };
    }
    case "DECIDE": {
      if (state.current) {
        state.current.resolver(action.decision);
      }
      return {
        ...state,
        isVisible: false,
        tool: undefined,
        current: null,
      };
    }
    case "CANCEL": {
      if (state.current) {
        state.current.reject();
      }
      return {
        ...state,
        isVisible: false,
        tool: undefined,
        current: null,
      };
    }
    case "HIDE": {
      return {
        ...state,
        isVisible: false,
        tool: undefined,
        current: null,
      };
    }
  }
}
