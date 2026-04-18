import type { Message, PermissionDecision, PromptEntry } from "wave-agent-sdk";

// ==========================================
// useChat reducers
// ==========================================

export interface AgentState {
  messages: Message[];
  isLoading: boolean;
  isCommandRunning: boolean;
  isCompressing: boolean;
  latestTotalTokens: number;
}

export type AgentAction =
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_COMMAND_RUNNING"; isCommandRunning: boolean }
  | { type: "SET_COMPRESSING"; isCompressing: boolean }
  | { type: "SET_TOKENS"; latestTotalTokens: number }
  | {
      type: "SET_AGENT_STATE";
      messages: Message[];
      isLoading: boolean;
      isCommandRunning: boolean;
      isCompressing: boolean;
      latestTotalTokens: number;
    };

export function agentReducer(
  state: AgentState,
  action: AgentAction,
): AgentState {
  switch (action.type) {
    case "SET_MESSAGES":
      return { ...state, messages: action.messages };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "SET_COMMAND_RUNNING":
      return { ...state, isCommandRunning: action.isCommandRunning };
    case "SET_COMPRESSING":
      return { ...state, isCompressing: action.isCompressing };
    case "SET_TOKENS":
      return { ...state, latestTotalTokens: action.latestTotalTokens };
    case "SET_AGENT_STATE":
      return {
        messages: action.messages,
        isLoading: action.isLoading,
        isCommandRunning: action.isCommandRunning,
        isCompressing: action.isCompressing,
        latestTotalTokens: action.latestTotalTokens,
      };
    default:
      return state;
  }
}

export interface SessionState {
  sessionId: string;
  workingDirectory: string;
  currentModel: string;
  configuredModels: string[];
}

export type SessionAction =
  | { type: "SET_SESSION_ID"; sessionId: string }
  | { type: "SET_WORKING_DIRECTORY"; workingDirectory: string }
  | { type: "SET_CURRENT_MODEL"; currentModel: string }
  | { type: "SET_CONFIGURED_MODELS"; configuredModels: string[] }
  | {
      type: "SET_SESSION_STATE";
      sessionId: string;
      workingDirectory: string;
      currentModel: string;
      configuredModels: string[];
    };

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "SET_SESSION_ID":
      return { ...state, sessionId: action.sessionId };
    case "SET_WORKING_DIRECTORY":
      return { ...state, workingDirectory: action.workingDirectory };
    case "SET_CURRENT_MODEL":
      return { ...state, currentModel: action.currentModel };
    case "SET_CONFIGURED_MODELS":
      return { ...state, configuredModels: action.configuredModels };
    case "SET_SESSION_STATE":
      return {
        sessionId: action.sessionId,
        workingDirectory: action.workingDirectory,
        currentModel: action.currentModel,
        configuredModels: action.configuredModels,
      };
    default:
      return state;
  }
}

export interface ConfirmationItem {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  planContent?: string;
  resolver: (decision: PermissionDecision) => void;
  reject: () => void;
}

export interface ChatConfirmationState {
  isConfirmationVisible: boolean;
  confirmingTool:
    | {
        name: string;
        input?: Record<string, unknown>;
        suggestedPrefix?: string;
        hidePersistentOption?: boolean;
        planContent?: string;
      }
    | undefined;
  confirmationQueue: ConfirmationItem[];
  currentConfirmation: ConfirmationItem | null;
}

export type ChatConfirmationAction =
  | { type: "SHOW_CONFIRMATION"; item: ConfirmationItem }
  | { type: "PROCESS_NEXT" }
  | { type: "HIDE_CONFIRMATION" }
  | { type: "CANCEL_CONFIRMATION" }
  | { type: "SET_CONFIRMATION_DECISION"; decision: PermissionDecision };

export function chatConfirmationReducer(
  state: ChatConfirmationState,
  action: ChatConfirmationAction,
): ChatConfirmationState {
  switch (action.type) {
    case "SHOW_CONFIRMATION": {
      const newQueue = [...state.confirmationQueue, action.item];
      if (!state.isConfirmationVisible) {
        const item = action.item;
        return {
          ...state,
          confirmationQueue: newQueue.slice(1),
          currentConfirmation: item,
          confirmingTool: {
            name: item.toolName,
            input: item.toolInput,
            suggestedPrefix: item.suggestedPrefix,
            hidePersistentOption: item.hidePersistentOption,
            planContent: item.planContent,
          },
          isConfirmationVisible: true,
        };
      }
      return { ...state, confirmationQueue: newQueue };
    }
    case "PROCESS_NEXT": {
      if (state.confirmationQueue.length > 0 && !state.isConfirmationVisible) {
        const next = state.confirmationQueue[0];
        return {
          ...state,
          confirmationQueue: state.confirmationQueue.slice(1),
          currentConfirmation: next,
          confirmingTool: {
            name: next.toolName,
            input: next.toolInput,
            suggestedPrefix: next.suggestedPrefix,
            hidePersistentOption: next.hidePersistentOption,
            planContent: next.planContent,
          },
          isConfirmationVisible: true,
        };
      }
      return state;
    }
    case "HIDE_CONFIRMATION":
      return {
        ...state,
        isConfirmationVisible: false,
        confirmingTool: undefined,
        currentConfirmation: null,
      };
    case "SET_CONFIRMATION_DECISION": {
      if (state.currentConfirmation) {
        state.currentConfirmation.resolver(action.decision);
      }
      return {
        ...state,
        isConfirmationVisible: false,
        confirmingTool: undefined,
        currentConfirmation: null,
      };
    }
    case "CANCEL_CONFIRMATION": {
      if (state.currentConfirmation) {
        state.currentConfirmation.reject();
      }
      return {
        ...state,
        isConfirmationVisible: false,
        confirmingTool: undefined,
        currentConfirmation: null,
      };
    }
    default:
      return state;
  }
}

export interface UIState {
  isExpanded: boolean;
  isTaskListVisible: boolean;
}

export type UIAction =
  | { type: "TOGGLE_EXPANDED" }
  | { type: "SET_EXPANDED"; isExpanded: boolean }
  | { type: "TOGGLE_TASK_LIST" }
  | { type: "SET_TASK_LIST_VISIBLE"; isTaskListVisible: boolean };

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "TOGGLE_EXPANDED":
      return { ...state, isExpanded: !state.isExpanded };
    case "SET_EXPANDED":
      return { ...state, isExpanded: action.isExpanded };
    case "TOGGLE_TASK_LIST":
      return { ...state, isTaskListVisible: !state.isTaskListVisible };
    case "SET_TASK_LIST_VISIBLE":
      return { ...state, isTaskListVisible: action.isTaskListVisible };
    default:
      return state;
  }
}

// ==========================================
// ConfirmationSelector reducers
// ==========================================

export interface ConfirmationSelectorState {
  selectedOption: "clear" | "auto" | "allow" | "alternative";
  alternativeText: string;
  alternativeCursorPosition: number;
  hasUserInput: boolean;
}

export interface DetailOutput {
  stdout: string;
  stderr: string;
  status: string;
  outputPath?: string;
}

export type ConfirmationSelectorAction =
  | {
      type: "SELECT_OPTION";
      option: ConfirmationSelectorState["selectedOption"];
    }
  | { type: "UPDATE_ALTERNATIVE_TEXT"; text: string; cursorPosition: number }
  | { type: "INPUT_CHARACTER_CONFIRMATION"; input: string }
  | { type: "DELETE_BEFORE_CURSOR_ALT" }
  | { type: "MOVE_ALTERNATIVE_CURSOR"; cursorPosition: number }
  | { type: "SET_HAS_USER_INPUT"; hasUserInput: boolean };

export function confirmationSelectorReducer(
  state: ConfirmationSelectorState,
  action: ConfirmationSelectorAction,
): ConfirmationSelectorState {
  switch (action.type) {
    case "SELECT_OPTION":
      return { ...state, selectedOption: action.option };
    case "UPDATE_ALTERNATIVE_TEXT":
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: action.text,
        alternativeCursorPosition: action.cursorPosition,
        hasUserInput: true,
      };
    case "MOVE_ALTERNATIVE_CURSOR": {
      const delta = action.cursorPosition;
      const newPos = state.alternativeCursorPosition + delta;
      return {
        ...state,
        alternativeCursorPosition: Math.max(
          0,
          Math.min(state.alternativeText.length, newPos),
        ),
      };
    }
    case "INPUT_CHARACTER_CONFIRMATION": {
      const text =
        state.alternativeText.slice(0, state.alternativeCursorPosition) +
        action.input +
        state.alternativeText.slice(state.alternativeCursorPosition);
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: text,
        alternativeCursorPosition:
          state.alternativeCursorPosition + action.input.length,
        hasUserInput: true,
      };
    }
    case "DELETE_BEFORE_CURSOR_ALT": {
      if (state.alternativeCursorPosition <= 0) return state;
      const text =
        state.alternativeText.slice(0, state.alternativeCursorPosition - 1) +
        state.alternativeText.slice(state.alternativeCursorPosition);
      return {
        ...state,
        selectedOption: "alternative",
        alternativeText: text,
        alternativeCursorPosition: state.alternativeCursorPosition - 1,
        hasUserInput: text.length > 0,
      };
    }
    case "SET_HAS_USER_INPUT":
      return { ...state, hasUserInput: action.hasUserInput };
    default:
      return state;
  }
}

export interface QuestionState {
  currentQuestionIndex: number;
  selectedOptionIndex: number;
  selectedOptionIndices: Set<number>;
  userAnswers: Record<string, string>;
  otherText: string;
  otherCursorPosition: number;
  savedStates: Record<
    number,
    {
      selectedOptionIndex: number;
      selectedOptionIndices: Set<number>;
      otherText: string;
      otherCursorPosition: number;
    }
  >;
}

export type QuestionAction =
  | { type: "SELECT_OPTION_INDEX"; index: number }
  | { type: "SELECT_OPTION_INDEX_DELTA"; delta: number; maxOptions?: number }
  | { type: "TOGGLE_CURRENT_OPTION_INDEX" }
  | { type: "UPDATE_OTHER_TEXT"; text: string; cursorPosition: number }
  | { type: "APPEND_OTHER_TEXT"; input: string }
  | { type: "INPUT_CHARACTER"; input: string; optionsCount: number }
  | { type: "DELETE_BEFORE_CURSOR_OTHER"; maxOptions?: number }
  | { type: "MOVE_OTHER_CURSOR"; cursorPosition: number; maxOptions?: number }
  | {
      type: "NAVIGATE_QUESTION";
      direction: number;
      questions: Array<{
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      }>;
    }
  | {
      type: "CONFIRM_ANSWER";
      questions: Array<{
        question: string;
        options: Array<{ label: string }>;
        multiSelect?: boolean;
      }>;
      pendingDecisionRef: React.MutableRefObject<
        import("wave-agent-sdk").PermissionDecision | null
      >;
    }
  | { type: "SET_QUESTION_STATE"; state: Partial<QuestionState> };

export function questionReducer(
  state: QuestionState,
  action: QuestionAction,
): QuestionState {
  switch (action.type) {
    case "SELECT_OPTION_INDEX":
      return { ...state, selectedOptionIndex: action.index };
    case "SELECT_OPTION_INDEX_DELTA": {
      const newIndex = state.selectedOptionIndex + action.delta;
      const maxIndex = (action.maxOptions ?? Infinity) - 1;
      return {
        ...state,
        selectedOptionIndex: Math.max(0, Math.min(maxIndex, newIndex)),
      };
    }
    case "TOGGLE_CURRENT_OPTION_INDEX": {
      const nextIndices = new Set(state.selectedOptionIndices);
      if (nextIndices.has(state.selectedOptionIndex)) {
        nextIndices.delete(state.selectedOptionIndex);
      } else {
        nextIndices.add(state.selectedOptionIndex);
      }
      return { ...state, selectedOptionIndices: nextIndices };
    }
    case "UPDATE_OTHER_TEXT":
      return {
        ...state,
        otherText: action.text,
        otherCursorPosition: action.cursorPosition,
      };
    case "INPUT_CHARACTER": {
      const otherIdx = (action.optionsCount || 0) - 1;
      if (state.selectedOptionIndex !== otherIdx) return state;
      const text =
        state.otherText.slice(0, state.otherCursorPosition) +
        action.input +
        state.otherText.slice(state.otherCursorPosition);
      return {
        ...state,
        otherText: text,
        otherCursorPosition: state.otherCursorPosition + action.input.length,
      };
    }
    case "APPEND_OTHER_TEXT": {
      const text =
        state.otherText.slice(0, state.otherCursorPosition) +
        action.input +
        state.otherText.slice(state.otherCursorPosition);
      return {
        ...state,
        otherText: text,
        otherCursorPosition: state.otherCursorPosition + action.input.length,
      };
    }
    case "DELETE_BEFORE_CURSOR_OTHER": {
      const otherIdx = (action.maxOptions ?? 0) - 1;
      if (state.selectedOptionIndex !== otherIdx) return state;
      if (state.otherCursorPosition <= 0) return state;
      return {
        ...state,
        otherText:
          state.otherText.slice(0, state.otherCursorPosition - 1) +
          state.otherText.slice(state.otherCursorPosition),
        otherCursorPosition: state.otherCursorPosition - 1,
      };
    }
    case "MOVE_OTHER_CURSOR": {
      const otherIdx = (action.maxOptions ?? 0) - 1;
      if (state.selectedOptionIndex !== otherIdx) return state;
      const delta = action.cursorPosition;
      const newPos = state.otherCursorPosition + delta;
      return {
        ...state,
        otherCursorPosition: Math.max(
          0,
          Math.min(state.otherText.length, newPos),
        ),
      };
    }
    case "NAVIGATE_QUESTION": {
      const questions = action.questions;
      let nextIndex = state.currentQuestionIndex + action.direction;
      if (nextIndex < 0) nextIndex = questions.length - 1;
      if (nextIndex >= questions.length) nextIndex = 0;

      if (nextIndex === state.currentQuestionIndex) return state;

      const savedStates = {
        ...state.savedStates,
        [state.currentQuestionIndex]: {
          selectedOptionIndex: state.selectedOptionIndex,
          selectedOptionIndices: state.selectedOptionIndices,
          otherText: state.otherText,
          otherCursorPosition: state.otherCursorPosition,
        },
      };

      const nextState = savedStates[nextIndex] || {
        selectedOptionIndex: 0,
        selectedOptionIndices: new Set<number>(),
        otherText: "",
        otherCursorPosition: 0,
      };

      return {
        ...state,
        currentQuestionIndex: nextIndex,
        ...nextState,
        savedStates,
      };
    }
    case "CONFIRM_ANSWER": {
      const questions = action.questions;
      const currentQuestion = questions[state.currentQuestionIndex];
      if (!currentQuestion) return state;

      const options = [...currentQuestion.options, { label: "Other" }];
      const isOtherFocused = state.selectedOptionIndex === options.length - 1;
      let answer = "";
      if (currentQuestion.multiSelect) {
        const selectedLabels = Array.from(state.selectedOptionIndices)
          .filter((i) => i < currentQuestion.options.length)
          .map((i) => currentQuestion.options[i].label);
        const isOtherChecked = state.selectedOptionIndices.has(
          options.length - 1,
        );
        if (isOtherChecked && state.otherText.trim()) {
          selectedLabels.push(state.otherText.trim());
        }
        answer = selectedLabels.join(", ");
      } else {
        if (isOtherFocused) {
          answer = state.otherText.trim();
        } else {
          answer = options[state.selectedOptionIndex].label;
        }
      }

      if (!answer) return state;

      const newAnswers = {
        ...state.userAnswers,
        [currentQuestion.question]: answer,
      };

      if (state.currentQuestionIndex < questions.length - 1) {
        const nextIndex = state.currentQuestionIndex + 1;
        const savedStates = {
          ...state.savedStates,
          [state.currentQuestionIndex]: {
            selectedOptionIndex: state.selectedOptionIndex,
            selectedOptionIndices: state.selectedOptionIndices,
            otherText: state.otherText,
            otherCursorPosition: state.otherCursorPosition,
          },
        };

        const nextState = savedStates[nextIndex] || {
          selectedOptionIndex: 0,
          selectedOptionIndices: new Set<number>(),
          otherText: "",
          otherCursorPosition: 0,
        };

        return {
          ...state,
          currentQuestionIndex: nextIndex,
          ...nextState,
          userAnswers: newAnswers,
          savedStates,
        };
      } else {
        const finalAnswers = { ...newAnswers };
        for (const [idxStr, s] of Object.entries(state.savedStates)) {
          const idx = parseInt(idxStr);
          const q = questions[idx];
          if (q && !finalAnswers[q.question]) {
            const opts = [...q.options, { label: "Other" }];
            let a = "";
            if (q.multiSelect) {
              const selectedLabels = Array.from(s.selectedOptionIndices)
                .filter((i) => i < q.options.length)
                .map((i) => q.options[i].label);
              const isOtherChecked = s.selectedOptionIndices.has(
                opts.length - 1,
              );
              if (isOtherChecked && s.otherText.trim()) {
                selectedLabels.push(s.otherText.trim());
              }
              a = selectedLabels.join(", ");
            } else {
              if (s.selectedOptionIndex === opts.length - 1) {
                a = s.otherText.trim();
              } else {
                a = opts[s.selectedOptionIndex].label;
              }
            }
            if (a) finalAnswers[q.question] = a;
          }
        }

        const allAnswered = questions.every((q) => finalAnswers[q.question]);
        if (!allAnswered) return state;

        action.pendingDecisionRef.current = {
          behavior: "allow",
          message: JSON.stringify(finalAnswers),
        };
        return {
          ...state,
          userAnswers: finalAnswers,
        };
      }
    }
    case "SET_QUESTION_STATE":
      return { ...state, ...action.state };
    default:
      return state;
  }
}

// ==========================================
// BackgroundTaskManager reducer
// ==========================================

export interface TaskManagerState {
  selectedIndex: number;
  viewMode: "list" | "detail";
  detailTaskId: string | null;
  detailOutput: DetailOutput | null;
}

export type TaskManagerAction =
  | { type: "SELECT_TASK"; taskId: string }
  | { type: "GO_BACK_TO_LIST" }
  | { type: "SET_DETAIL_OUTPUT"; output: DetailOutput | null }
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number };

export function taskManagerReducer(
  state: TaskManagerState,
  action: TaskManagerAction,
): TaskManagerState {
  switch (action.type) {
    case "SELECT_TASK":
      return {
        ...state,
        viewMode: "detail",
        detailTaskId: action.taskId,
        detailOutput: null,
      };
    case "GO_BACK_TO_LIST":
      return {
        ...state,
        viewMode: "list",
        detailTaskId: null,
        detailOutput: null,
      };
    case "SET_DETAIL_OUTPUT":
      return {
        ...state,
        detailOutput: action.output,
      };
    case "NAVIGATE_UP":
      return {
        ...state,
        selectedIndex: Math.max(0, state.selectedIndex - 1),
      };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    default:
      return state;
  }
}

// ==========================================
// McpManager reducer
// ==========================================

export interface McpManagerState {
  selectedIndex: number;
  viewMode: "list" | "detail";
}

export type McpManagerAction =
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number }
  | { type: "SELECT_DETAIL" }
  | { type: "GO_TO_LIST" };

export function mcpManagerReducer(
  state: McpManagerState,
  action: McpManagerAction,
): McpManagerState {
  switch (action.type) {
    case "NAVIGATE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    case "SELECT_DETAIL":
      return { ...state, viewMode: "detail" };
    case "GO_TO_LIST":
      return { ...state, viewMode: "list" };
    default:
      return state;
  }
}

// ==========================================
// App reducer
// ==========================================

export interface AppState {
  isExiting: boolean;
  worktreeStatus: {
    hasUncommittedChanges: boolean;
    hasNewCommits: boolean;
  } | null;
}

export type AppAction =
  | {
      type: "START_EXIT";
      worktreeStatus: {
        hasUncommittedChanges: boolean;
        hasNewCommits: boolean;
      };
    }
  | { type: "CANCEL_EXIT" };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "START_EXIT":
      return { isExiting: true, worktreeStatus: action.worktreeStatus };
    case "CANCEL_EXIT":
      return { isExiting: false, worktreeStatus: state.worktreeStatus };
    default:
      return state;
  }
}

// ==========================================
// RewindCommand reducer
// ==========================================

export interface RewindState {
  messages: Message[];
  isLoading: boolean;
  selectedIndex: number;
}

export type RewindAction =
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number }
  | { type: "RESET_INDEX"; index: number };

export function rewindReducer(
  state: RewindState,
  action: RewindAction,
): RewindState {
  switch (action.type) {
    case "SET_MESSAGES":
      return { ...state, messages: action.messages, isLoading: false };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "NAVIGATE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    case "RESET_INDEX":
      return { ...state, selectedIndex: action.index };
    default:
      return state;
  }
}

// ==========================================
// HelpView reducer
// ==========================================

export type HelpActiveTab = "general" | "commands" | "custom-commands";

export interface HelpState {
  activeTab: HelpActiveTab;
  selectedIndex: number;
}

export type HelpAction =
  | { type: "NEXT_TAB"; tabs: HelpActiveTab[] }
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number };

export function helpReducer(state: HelpState, action: HelpAction): HelpState {
  switch (action.type) {
    case "NEXT_TAB": {
      const currentIndex = action.tabs.indexOf(state.activeTab);
      const nextIndex = (currentIndex + 1) % action.tabs.length;
      return { activeTab: action.tabs[nextIndex], selectedIndex: 0 };
    }
    case "NAVIGATE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    default:
      return state;
  }
}

// ==========================================
// HistorySearch reducer
// ==========================================

export interface HistoryState {
  selectedIndex: number;
  entries: PromptEntry[];
}

export type HistoryAction =
  | { type: "SET_ENTRIES"; entries: PromptEntry[] }
  | { type: "NAVIGATE_UP" }
  | { type: "NAVIGATE_DOWN"; max: number };

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "SET_ENTRIES":
      return { selectedIndex: 0, entries: action.entries };
    case "NAVIGATE_UP":
      return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) };
    case "NAVIGATE_DOWN":
      return {
        ...state,
        selectedIndex: Math.min(action.max, state.selectedIndex + 1),
      };
    default:
      return state;
  }
}

// ==========================================
// PluginDetail reducer
// ==========================================

export interface PluginDetailState {
  selectedScopeIndex: number;
  selectedActionIndex: number;
}

export type PluginDetailAction =
  | { type: "NAVIGATE_UP"; maxScope: number; maxAction: number }
  | { type: "NAVIGATE_DOWN"; maxScope: number; maxAction: number }
  | { type: "RESET" };

export function pluginDetailReducer(
  state: PluginDetailState,
  action: PluginDetailAction,
): PluginDetailState {
  switch (action.type) {
    case "NAVIGATE_UP":
      return {
        selectedScopeIndex:
          state.selectedScopeIndex > 0
            ? state.selectedScopeIndex - 1
            : action.maxScope,
        selectedActionIndex:
          state.selectedActionIndex > 0
            ? state.selectedActionIndex - 1
            : action.maxAction,
      };
    case "NAVIGATE_DOWN":
      return {
        selectedScopeIndex:
          state.selectedScopeIndex < action.maxScope
            ? state.selectedScopeIndex + 1
            : 0,
        selectedActionIndex:
          state.selectedActionIndex < action.maxAction
            ? state.selectedActionIndex + 1
            : 0,
      };
    case "RESET":
      return { selectedScopeIndex: 0, selectedActionIndex: 0 };
    default:
      return state;
  }
}
