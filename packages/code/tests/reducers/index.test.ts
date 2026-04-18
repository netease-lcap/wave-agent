import { describe, it, expect } from "vitest";
import type { Message, PromptEntry } from "wave-agent-sdk";
import {
  agentReducer,
  sessionReducer,
  chatConfirmationReducer,
  uiReducer,
  confirmationSelectorReducer,
  questionReducer,
  taskManagerReducer,
  mcpManagerReducer,
  appReducer,
  rewindReducer,
  helpReducer,
  historyReducer,
  pluginDetailReducer,
  type ConfirmationItem,
} from "../../src/reducers/index.js";

type QuestionArray = Array<{
  question: string;
  options: Array<{ label: string }>;
  multiSelect?: boolean;
}>;

describe("agentReducer", () => {
  const initialState = {
    messages: [],
    isLoading: false,
    isCommandRunning: false,
    isCompressing: false,
    latestTotalTokens: 0,
  };

  it("handles SET_MESSAGES", () => {
    const msgs = [{ role: "user" as const, content: "hi" }];
    const state = agentReducer(initialState, {
      type: "SET_MESSAGES",
      messages: msgs as unknown as Message[],
    });
    expect(state.messages).toEqual(msgs);
  });

  it("handles SET_LOADING", () => {
    const state = agentReducer(initialState, {
      type: "SET_LOADING",
      isLoading: true,
    });
    expect(state.isLoading).toBe(true);
  });

  it("handles SET_COMMAND_RUNNING", () => {
    const state = agentReducer(initialState, {
      type: "SET_COMMAND_RUNNING",
      isCommandRunning: true,
    });
    expect(state.isCommandRunning).toBe(true);
  });

  it("handles SET_COMPRESSING", () => {
    const state = agentReducer(initialState, {
      type: "SET_COMPRESSING",
      isCompressing: true,
    });
    expect(state.isCompressing).toBe(true);
  });

  it("handles SET_TOKENS", () => {
    const state = agentReducer(initialState, {
      type: "SET_TOKENS",
      latestTotalTokens: 500,
    });
    expect(state.latestTotalTokens).toBe(500);
  });

  it("handles SET_AGENT_STATE", () => {
    const msgs = [{ role: "user" as const, content: "hi" }];
    const state = agentReducer(initialState, {
      type: "SET_AGENT_STATE",
      messages: msgs as unknown as Message[],
      isLoading: true,
      isCommandRunning: true,
      isCompressing: true,
      latestTotalTokens: 1000,
    });
    expect(state.messages).toEqual(msgs);
    expect(state.isLoading).toBe(true);
    expect(state.isCommandRunning).toBe(true);
    expect(state.isCompressing).toBe(true);
    expect(state.latestTotalTokens).toBe(1000);
  });
});

describe("sessionReducer", () => {
  const initialState = {
    sessionId: "",
    workingDirectory: "",
    currentModel: "",
    configuredModels: [],
  };

  it("handles SET_SESSION_ID", () => {
    const state = sessionReducer(initialState, {
      type: "SET_SESSION_ID",
      sessionId: "abc",
    });
    expect(state.sessionId).toBe("abc");
  });

  it("handles SET_WORKING_DIRECTORY", () => {
    const state = sessionReducer(initialState, {
      type: "SET_WORKING_DIRECTORY",
      workingDirectory: "/tmp",
    });
    expect(state.workingDirectory).toBe("/tmp");
  });

  it("handles SET_CURRENT_MODEL", () => {
    const state = sessionReducer(initialState, {
      type: "SET_CURRENT_MODEL",
      currentModel: "gpt-4",
    });
    expect(state.currentModel).toBe("gpt-4");
  });

  it("handles SET_CONFIGURED_MODELS", () => {
    const state = sessionReducer(initialState, {
      type: "SET_CONFIGURED_MODELS",
      configuredModels: ["gpt-4", "gpt-3.5"],
    });
    expect(state.configuredModels).toEqual(["gpt-4", "gpt-3.5"]);
  });

  it("handles SET_SESSION_STATE", () => {
    const state = sessionReducer(initialState, {
      type: "SET_SESSION_STATE",
      sessionId: "s1",
      workingDirectory: "/tmp",
      currentModel: "gpt-4",
      configuredModels: ["gpt-4"],
    });
    expect(state.sessionId).toBe("s1");
    expect(state.workingDirectory).toBe("/tmp");
    expect(state.currentModel).toBe("gpt-4");
    expect(state.configuredModels).toEqual(["gpt-4"]);
  });
});

describe("chatConfirmationReducer", () => {
  const initialState = {
    isConfirmationVisible: false,
    confirmingTool: undefined,
    confirmationQueue: [],
    currentConfirmation: null,
  };

  it("handles SHOW_CONFIRMATION when nothing visible", () => {
    const item = {
      toolName: "bash",
      resolver: () => {},
      reject: () => {},
    };
    const state = chatConfirmationReducer(initialState, {
      type: "SHOW_CONFIRMATION",
      item: item as unknown as ConfirmationItem,
    });
    expect(state.isConfirmationVisible).toBe(true);
    expect(state.confirmingTool?.name).toBe("bash");
    expect(state.confirmationQueue).toEqual([]);
  });

  it("handles SHOW_CONFIRMATION when already visible (queues)", () => {
    const item1 = { toolName: "bash1", resolver: () => {}, reject: () => {} };
    const item2 = { toolName: "bash2", resolver: () => {}, reject: () => {} };
    const state1 = chatConfirmationReducer(initialState, {
      type: "SHOW_CONFIRMATION",
      item: item1 as unknown as ConfirmationItem,
    });
    const state2 = chatConfirmationReducer(state1, {
      type: "SHOW_CONFIRMATION",
      item: item2 as unknown as ConfirmationItem,
    });
    expect(state2.isConfirmationVisible).toBe(true);
    expect(state2.confirmationQueue).toHaveLength(1);
  });

  it("handles PROCESS_NEXT with queued items", () => {
    const item = { toolName: "bash", resolver: () => {}, reject: () => {} };
    const state1 = chatConfirmationReducer(initialState, {
      type: "SHOW_CONFIRMATION",
      item: item as unknown as ConfirmationItem,
    });
    const hidden = chatConfirmationReducer(state1, {
      type: "HIDE_CONFIRMATION",
    });
    const state2 = chatConfirmationReducer(hidden, { type: "PROCESS_NEXT" });
    // Should process next from queue (but queue is empty after first was consumed)
    expect(state2.isConfirmationVisible).toBe(false);
  });

  it("handles HIDE_CONFIRMATION", () => {
    const item = { toolName: "bash", resolver: () => {}, reject: () => {} };
    const state1 = chatConfirmationReducer(initialState, {
      type: "SHOW_CONFIRMATION",
      item: item as unknown as ConfirmationItem,
    });
    const state2 = chatConfirmationReducer(state1, {
      type: "HIDE_CONFIRMATION",
    });
    expect(state2.isConfirmationVisible).toBe(false);
    expect(state2.confirmingTool).toBe(undefined);
    expect(state2.currentConfirmation).toBe(null);
  });

  it("handles SET_CONFIRMATION_DECISION", () => {
    let resolved = false;
    const item = {
      toolName: "bash",
      resolver: () => {
        resolved = true;
      },
      reject: () => {},
    };
    const state1 = chatConfirmationReducer(initialState, {
      type: "SHOW_CONFIRMATION",
      item: item as unknown as ConfirmationItem,
    });
    const state2 = chatConfirmationReducer(state1, {
      type: "SET_CONFIRMATION_DECISION",
      decision: { behavior: "allow" },
    });
    expect(resolved).toBe(true);
    expect(state2.isConfirmationVisible).toBe(false);
  });

  it("handles CANCEL_CONFIRMATION", () => {
    let rejected = false;
    const item = {
      toolName: "bash",
      resolver: () => {},
      reject: () => {
        rejected = true;
      },
    };
    const state1 = chatConfirmationReducer(initialState, {
      type: "SHOW_CONFIRMATION",
      item: item as unknown as ConfirmationItem,
    });
    const state2 = chatConfirmationReducer(state1, {
      type: "CANCEL_CONFIRMATION",
    });
    expect(rejected).toBe(true);
    expect(state2.isConfirmationVisible).toBe(false);
  });
});

describe("uiReducer", () => {
  const initialState = { isExpanded: false, isTaskListVisible: true };

  it("handles TOGGLE_EXPANDED", () => {
    const state = uiReducer(initialState, { type: "TOGGLE_EXPANDED" });
    expect(state.isExpanded).toBe(true);
  });

  it("handles SET_EXPANDED", () => {
    const state = uiReducer(initialState, {
      type: "SET_EXPANDED",
      isExpanded: true,
    });
    expect(state.isExpanded).toBe(true);
  });

  it("handles TOGGLE_TASK_LIST", () => {
    const state = uiReducer(initialState, { type: "TOGGLE_TASK_LIST" });
    expect(state.isTaskListVisible).toBe(false);
  });

  it("handles SET_TASK_LIST_VISIBLE", () => {
    const state = uiReducer(initialState, {
      type: "SET_TASK_LIST_VISIBLE",
      isTaskListVisible: false,
    });
    expect(state.isTaskListVisible).toBe(false);
  });
});

describe("confirmationSelectorReducer", () => {
  const initialState = {
    selectedOption: "allow" as const,
    alternativeText: "",
    alternativeCursorPosition: 0,
    hasUserInput: false,
  };

  it("handles SELECT_OPTION", () => {
    const state = confirmationSelectorReducer(initialState, {
      type: "SELECT_OPTION",
      option: "auto",
    });
    expect(state.selectedOption).toBe("auto");
  });

  it("handles UPDATE_ALTERNATIVE_TEXT", () => {
    const state = confirmationSelectorReducer(initialState, {
      type: "UPDATE_ALTERNATIVE_TEXT",
      text: "hello",
      cursorPosition: 5,
    });
    expect(state.alternativeText).toBe("hello");
    expect(state.selectedOption).toBe("alternative");
    expect(state.hasUserInput).toBe(true);
  });

  it("handles INPUT_CHARACTER_CONFIRMATION", () => {
    const state = confirmationSelectorReducer(initialState, {
      type: "INPUT_CHARACTER_CONFIRMATION",
      input: "a",
    });
    expect(state.alternativeText).toBe("a");
    expect(state.alternativeCursorPosition).toBe(1);
  });

  it("handles MOVE_ALTERNATIVE_CURSOR", () => {
    const state = confirmationSelectorReducer(
      {
        ...initialState,
        alternativeText: "hello",
        alternativeCursorPosition: 3,
      },
      { type: "MOVE_ALTERNATIVE_CURSOR", cursorPosition: 1 },
    );
    expect(state.alternativeCursorPosition).toBe(4);
  });

  it("handles MOVE_ALTERNATIVE_CURSOR with boundary (negative)", () => {
    const state = confirmationSelectorReducer(initialState, {
      type: "MOVE_ALTERNATIVE_CURSOR",
      cursorPosition: -1,
    });
    expect(state.alternativeCursorPosition).toBe(0);
  });

  it("handles DELETE_BEFORE_CURSOR_ALT", () => {
    const state = confirmationSelectorReducer(
      {
        ...initialState,
        alternativeText: "hello",
        alternativeCursorPosition: 3,
      },
      { type: "DELETE_BEFORE_CURSOR_ALT" },
    );
    expect(state.alternativeText).toBe("helo");
    expect(state.alternativeCursorPosition).toBe(2);
  });

  it("handles DELETE_BEFORE_CURSOR_ALT at position 0 (no-op)", () => {
    const state = confirmationSelectorReducer(initialState, {
      type: "DELETE_BEFORE_CURSOR_ALT",
    });
    expect(state).toEqual(initialState);
  });

  it("handles SET_HAS_USER_INPUT", () => {
    const state = confirmationSelectorReducer(initialState, {
      type: "SET_HAS_USER_INPUT",
      hasUserInput: true,
    });
    expect(state.hasUserInput).toBe(true);
  });
});

describe("questionReducer", () => {
  const initialState = {
    currentQuestionIndex: 0,
    selectedOptionIndex: 0,
    selectedOptionIndices: new Set<number>(),
    userAnswers: {},
    otherText: "",
    otherCursorPosition: 0,
    savedStates: {},
  };

  it("handles SELECT_OPTION_INDEX", () => {
    const state = questionReducer(initialState, {
      type: "SELECT_OPTION_INDEX",
      index: 2,
    });
    expect(state.selectedOptionIndex).toBe(2);
  });

  it("handles SELECT_OPTION_INDEX_DELTA", () => {
    const state = questionReducer(initialState, {
      type: "SELECT_OPTION_INDEX_DELTA",
      delta: 1,
      maxOptions: 3,
    });
    expect(state.selectedOptionIndex).toBe(1);
  });

  it("handles SELECT_OPTION_INDEX_DELTA with boundary", () => {
    const state = questionReducer(initialState, {
      type: "SELECT_OPTION_INDEX_DELTA",
      delta: -1,
    });
    expect(state.selectedOptionIndex).toBe(0);
  });

  it("handles TOGGLE_CURRENT_OPTION_INDEX", () => {
    const state = questionReducer(initialState, {
      type: "TOGGLE_CURRENT_OPTION_INDEX",
    });
    expect(state.selectedOptionIndices.has(0)).toBe(true);
  });

  it("handles UPDATE_OTHER_TEXT", () => {
    const state = questionReducer(initialState, {
      type: "UPDATE_OTHER_TEXT",
      text: "custom",
      cursorPosition: 6,
    });
    expect(state.otherText).toBe("custom");
  });

  it("handles INPUT_CHARACTER when on Other option", () => {
    const state = questionReducer(
      { ...initialState, selectedOptionIndex: 2 },
      { type: "INPUT_CHARACTER", input: "a", optionsCount: 3 },
    );
    expect(state.otherText).toBe("a");
  });

  it("handles INPUT_CHARACTER when not on Other option (no-op)", () => {
    const state = questionReducer(
      { ...initialState, selectedOptionIndex: 0 },
      { type: "INPUT_CHARACTER", input: "a", optionsCount: 3 },
    );
    expect(state.otherText).toBe("");
  });

  it("handles APPEND_OTHER_TEXT", () => {
    const state = questionReducer(
      { ...initialState, otherText: "hello", otherCursorPosition: 3 },
      { type: "APPEND_OTHER_TEXT", input: "X" },
    );
    expect(state.otherText).toBe("helXlo");
    expect(state.otherCursorPosition).toBe(4);
  });

  it("handles DELETE_BEFORE_CURSOR_OTHER", () => {
    const state = questionReducer(
      {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "hello",
        otherCursorPosition: 3,
      },
      { type: "DELETE_BEFORE_CURSOR_OTHER", maxOptions: 3 },
    );
    expect(state.otherText).toBe("helo");
    expect(state.otherCursorPosition).toBe(2);
  });

  it("handles DELETE_BEFORE_CURSOR_OTHER at position 0 (no-op)", () => {
    const state = questionReducer(
      { ...initialState, selectedOptionIndex: 2, otherCursorPosition: 0 },
      { type: "DELETE_BEFORE_CURSOR_OTHER", maxOptions: 3 },
    );
    expect(state.otherCursorPosition).toBe(0);
  });

  it("handles MOVE_OTHER_CURSOR", () => {
    const state = questionReducer(
      {
        ...initialState,
        selectedOptionIndex: 2,
        otherText: "hello",
        otherCursorPosition: 2,
      },
      { type: "MOVE_OTHER_CURSOR", cursorPosition: 1, maxOptions: 3 },
    );
    expect(state.otherCursorPosition).toBe(3);
  });

  it("handles NAVIGATE_QUESTION forward", () => {
    const questions = [
      { question: "q1", options: [{ label: "a" }] },
      { question: "q2", options: [{ label: "b" }] },
    ];
    const state = questionReducer(initialState, {
      type: "NAVIGATE_QUESTION",
      direction: 1,
      questions: questions as unknown as QuestionArray,
    });
    expect(state.currentQuestionIndex).toBe(1);
    expect(state.savedStates[0]).toBeDefined();
  });

  it("handles NAVIGATE_QUESTION backward (wraps)", () => {
    const questions = [{ question: "q1", options: [{ label: "a" }] }];
    const state = questionReducer(initialState, {
      type: "NAVIGATE_QUESTION",
      direction: -1,
      questions: questions as unknown as QuestionArray,
    });
    expect(state.currentQuestionIndex).toBe(0);
  });

  it("handles CONFIRM_ANSWER with single question (single-select)", () => {
    const questions = [
      { question: "color", options: [{ label: "red" }, { label: "blue" }] },
    ];
    const pendingDecisionRef = { current: null };
    const state = questionReducer(initialState, {
      type: "CONFIRM_ANSWER",
      questions: questions as unknown as QuestionArray,
      pendingDecisionRef: pendingDecisionRef as unknown as { current: null },
    });
    expect(state.userAnswers).toEqual({ color: "red" });
  });

  it("handles CONFIRM_ANSWER with Other option", () => {
    const questions = [{ question: "color", options: [{ label: "red" }] }];
    const pendingDecisionRef = { current: null };
    const state = questionReducer(
      { ...initialState, selectedOptionIndex: 1, otherText: "green" },
      {
        type: "CONFIRM_ANSWER",
        questions: questions as unknown as QuestionArray,
        pendingDecisionRef: pendingDecisionRef as unknown as { current: null },
      },
    );
    expect(state.userAnswers).toEqual({ color: "green" });
  });

  it("handles CONFIRM_ANSWER returns early if no answer", () => {
    const questions = [{ question: "color", options: [{ label: "red" }] }];
    const pendingDecisionRef = { current: null };
    questionReducer(
      { ...initialState, selectedOptionIndex: 1, otherText: "" },
      {
        type: "CONFIRM_ANSWER",
        questions: questions as unknown as QuestionArray,
        pendingDecisionRef: pendingDecisionRef as unknown as { current: null },
      },
    );
    expect(pendingDecisionRef.current).toBe(null);
  });

  it("handles SET_QUESTION_STATE", () => {
    const state = questionReducer(initialState, {
      type: "SET_QUESTION_STATE",
      state: { otherText: "test" },
    });
    expect(state.otherText).toBe("test");
  });
});

describe("taskManagerReducer", () => {
  const initialState = {
    selectedIndex: 0,
    viewMode: "list" as const,
    detailTaskId: null,
    detailOutput: null,
  };

  it("handles SELECT_TASK", () => {
    const state = taskManagerReducer(initialState, {
      type: "SELECT_TASK",
      taskId: "t1",
    });
    expect(state.viewMode).toBe("detail");
    expect(state.detailTaskId).toBe("t1");
    expect(state.detailOutput).toBe(null);
  });

  it("handles GO_BACK_TO_LIST", () => {
    const state1 = taskManagerReducer(initialState, {
      type: "SELECT_TASK",
      taskId: "t1",
    });
    const state2 = taskManagerReducer(state1, { type: "GO_BACK_TO_LIST" });
    expect(state2.viewMode).toBe("list");
    expect(state2.detailTaskId).toBe(null);
  });

  it("handles SET_DETAIL_OUTPUT", () => {
    const output = { stdout: "out", stderr: "", status: "completed" };
    const state = taskManagerReducer(initialState, {
      type: "SET_DETAIL_OUTPUT",
      output,
    });
    expect(state.detailOutput).toEqual(output);
  });

  it("handles NAVIGATE_UP", () => {
    const state = taskManagerReducer(
      { ...initialState, selectedIndex: 5 },
      { type: "NAVIGATE_UP" },
    );
    expect(state.selectedIndex).toBe(4);
  });

  it("handles NAVIGATE_UP at boundary", () => {
    const state = taskManagerReducer(initialState, { type: "NAVIGATE_UP" });
    expect(state.selectedIndex).toBe(0);
  });

  it("handles NAVIGATE_DOWN", () => {
    const state = taskManagerReducer(initialState, {
      type: "NAVIGATE_DOWN",
      max: 10,
    });
    expect(state.selectedIndex).toBe(1);
  });

  it("handles NAVIGATE_DOWN at boundary", () => {
    const state = taskManagerReducer(
      { ...initialState, selectedIndex: 5 },
      { type: "NAVIGATE_DOWN", max: 5 },
    );
    expect(state.selectedIndex).toBe(5);
  });
});

describe("mcpManagerReducer", () => {
  const initialState = { selectedIndex: 0, viewMode: "list" as const };

  it("handles NAVIGATE_UP", () => {
    const state = mcpManagerReducer(
      { ...initialState, selectedIndex: 3 },
      { type: "NAVIGATE_UP" },
    );
    expect(state.selectedIndex).toBe(2);
  });

  it("handles NAVIGATE_UP at boundary", () => {
    const state = mcpManagerReducer(initialState, { type: "NAVIGATE_UP" });
    expect(state.selectedIndex).toBe(0);
  });

  it("handles NAVIGATE_DOWN", () => {
    const state = mcpManagerReducer(initialState, {
      type: "NAVIGATE_DOWN",
      max: 5,
    });
    expect(state.selectedIndex).toBe(1);
  });

  it("handles SELECT_DETAIL", () => {
    const state = mcpManagerReducer(initialState, { type: "SELECT_DETAIL" });
    expect(state.viewMode).toBe("detail");
  });

  it("handles GO_TO_LIST", () => {
    const state = mcpManagerReducer(
      { ...initialState, viewMode: "detail" },
      { type: "GO_TO_LIST" },
    );
    expect(state.viewMode).toBe("list");
  });
});

describe("appReducer", () => {
  const initialState = { isExiting: false, worktreeStatus: null };

  it("handles START_EXIT", () => {
    const state = appReducer(initialState, {
      type: "START_EXIT",
      worktreeStatus: { hasUncommittedChanges: true, hasNewCommits: false },
    });
    expect(state.isExiting).toBe(true);
    expect(state.worktreeStatus).toEqual({
      hasUncommittedChanges: true,
      hasNewCommits: false,
    });
  });

  it("handles CANCEL_EXIT", () => {
    const state1 = appReducer(initialState, {
      type: "START_EXIT",
      worktreeStatus: { hasUncommittedChanges: true, hasNewCommits: false },
    });
    const state2 = appReducer(state1, { type: "CANCEL_EXIT" });
    expect(state2.isExiting).toBe(false);
    expect(state2.worktreeStatus).toEqual({
      hasUncommittedChanges: true,
      hasNewCommits: false,
    });
  });
});

describe("rewindReducer", () => {
  const initialState = { messages: [], isLoading: false, selectedIndex: 0 };

  it("handles SET_MESSAGES", () => {
    const msgs = [{ role: "user" as const, content: "hi" }];
    const state = rewindReducer(
      { ...initialState, isLoading: true },
      { type: "SET_MESSAGES", messages: msgs as unknown as Message[] },
    );
    expect(state.messages).toEqual(msgs);
    expect(state.isLoading).toBe(false);
  });

  it("handles SET_LOADING", () => {
    const state = rewindReducer(initialState, {
      type: "SET_LOADING",
      isLoading: true,
    });
    expect(state.isLoading).toBe(true);
  });

  it("handles NAVIGATE_UP", () => {
    const state = rewindReducer(
      { ...initialState, selectedIndex: 3 },
      { type: "NAVIGATE_UP" },
    );
    expect(state.selectedIndex).toBe(2);
  });

  it("handles NAVIGATE_DOWN", () => {
    const state = rewindReducer(initialState, {
      type: "NAVIGATE_DOWN",
      max: 10,
    });
    expect(state.selectedIndex).toBe(1);
  });

  it("handles RESET_INDEX", () => {
    const state = rewindReducer(
      { ...initialState, selectedIndex: 5 },
      { type: "RESET_INDEX", index: 0 },
    );
    expect(state.selectedIndex).toBe(0);
  });
});

describe("helpReducer", () => {
  const initialState = { activeTab: "general" as const, selectedIndex: 0 };

  it("handles NEXT_TAB", () => {
    const state = helpReducer(initialState, {
      type: "NEXT_TAB",
      tabs: ["general", "commands"],
    });
    expect(state.activeTab).toBe("commands");
    expect(state.selectedIndex).toBe(0);
  });

  it("handles NEXT_TAB wraps around", () => {
    const state = helpReducer(
      { ...initialState, activeTab: "commands" },
      { type: "NEXT_TAB", tabs: ["general", "commands"] },
    );
    expect(state.activeTab).toBe("general");
  });

  it("handles NAVIGATE_UP", () => {
    const state = helpReducer(
      { ...initialState, selectedIndex: 3 },
      { type: "NAVIGATE_UP" },
    );
    expect(state.selectedIndex).toBe(2);
  });

  it("handles NAVIGATE_DOWN", () => {
    const state = helpReducer(initialState, { type: "NAVIGATE_DOWN", max: 5 });
    expect(state.selectedIndex).toBe(1);
  });
});

describe("historyReducer", () => {
  const initialState = { selectedIndex: 0, entries: [] };

  it("handles SET_ENTRIES", () => {
    const entries: PromptEntry[] = [{ prompt: "hi", timestamp: 0 }];
    const state = historyReducer(
      {
        ...initialState,
        selectedIndex: 5,
        entries: [{ prompt: "old", timestamp: 0 } as unknown as PromptEntry],
      },
      {
        type: "SET_ENTRIES",
        entries: entries as unknown as (typeof initialState)["entries"],
      },
    );
    expect(state.selectedIndex).toBe(0);
    expect(state.entries).toEqual(entries);
  });

  it("handles NAVIGATE_UP", () => {
    const state = historyReducer(
      { ...initialState, selectedIndex: 2 },
      { type: "NAVIGATE_UP" },
    );
    expect(state.selectedIndex).toBe(1);
  });

  it("handles NAVIGATE_DOWN", () => {
    const state = historyReducer(initialState, {
      type: "NAVIGATE_DOWN",
      max: 5,
    });
    expect(state.selectedIndex).toBe(1);
  });
});

describe("pluginDetailReducer", () => {
  const initialState = { selectedScopeIndex: 0, selectedActionIndex: 0 };

  it("handles NAVIGATE_UP", () => {
    const state = pluginDetailReducer(
      { ...initialState, selectedScopeIndex: 2, selectedActionIndex: 1 },
      { type: "NAVIGATE_UP", maxScope: 2, maxAction: 1 },
    );
    expect(state.selectedScopeIndex).toBe(1);
    expect(state.selectedActionIndex).toBe(0);
  });

  it("handles NAVIGATE_UP wraps around", () => {
    const state = pluginDetailReducer(initialState, {
      type: "NAVIGATE_UP",
      maxScope: 2,
      maxAction: 1,
    });
    expect(state.selectedScopeIndex).toBe(2);
    expect(state.selectedActionIndex).toBe(1);
  });

  it("handles NAVIGATE_DOWN", () => {
    const state = pluginDetailReducer(initialState, {
      type: "NAVIGATE_DOWN",
      maxScope: 2,
      maxAction: 1,
    });
    expect(state.selectedScopeIndex).toBe(1);
    expect(state.selectedActionIndex).toBe(1);
  });

  it("handles NAVIGATE_DOWN wraps around", () => {
    const state = pluginDetailReducer(
      { ...initialState, selectedScopeIndex: 2, selectedActionIndex: 1 },
      { type: "NAVIGATE_DOWN", maxScope: 2, maxAction: 1 },
    );
    expect(state.selectedScopeIndex).toBe(0);
    expect(state.selectedActionIndex).toBe(0);
  });

  it("handles RESET", () => {
    const state = pluginDetailReducer(
      { ...initialState, selectedScopeIndex: 2, selectedActionIndex: 1 },
      { type: "RESET" },
    );
    expect(state.selectedScopeIndex).toBe(0);
    expect(state.selectedActionIndex).toBe(0);
  });
});
