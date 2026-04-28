import { InputState, InputAction } from "../managers/inputReducer.js";

export const SELECTOR_TRIGGERS = [
  {
    char: "@",
    type: "ACTIVATE_FILE_SELECTOR",
    shouldActivate: (char: string, pos: number, text: string) =>
      char === "@" && (pos === 1 || /\s/.test(text[pos - 2])),
  },
  {
    char: "/",
    type: "ACTIVATE_COMMAND_SELECTOR",
    shouldActivate: (
      char: string,
      pos: number,
      text: string,
      state: InputState,
    ) =>
      char === "/" &&
      !state.showFileSelector &&
      (pos === 1 || /\s/.test(text[pos - 2])),
  },
] as const;

export const getProjectedState = (state: InputState, char: string) => {
  const beforeCursor = state.inputText.substring(0, state.cursorPosition);
  const afterCursor = state.inputText.substring(state.cursorPosition);
  const newInputText = beforeCursor + char + afterCursor;
  const newCursorPosition = state.cursorPosition + char.length;
  return { newInputText, newCursorPosition };
};

export const getAtSelectorPosition = (
  text: string,
  cursorPosition: number,
): number => {
  let i = cursorPosition - 1;
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === "@") {
      // Check if this @ is at the start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        return i;
      }
      break;
    }
    i--;
  }
  return -1;
};

export const getSlashSelectorPosition = (
  text: string,
  cursorPosition: number,
): number => {
  let i = cursorPosition - 1;
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === "/") {
      // Check if this / is at the start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        return i;
      }
      break;
    }
    i--;
  }
  return -1;
};

export const updateSearchQueriesForActiveSelectors = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  inputText: string,
  cursorPosition: number,
): void => {
  if (state.showFileSelector && state.atPosition >= 0) {
    const queryStart = state.atPosition + 1;
    const queryEnd = cursorPosition;
    const newQuery = inputText.substring(queryStart, queryEnd);
    dispatch({ type: "SET_FILE_SEARCH_QUERY", payload: newQuery });
  } else if (state.showCommandSelector && state.slashPosition >= 0) {
    const queryStart = state.slashPosition + 1;
    const queryEnd = cursorPosition;
    const newQuery = inputText.substring(queryStart, queryEnd);
    dispatch({ type: "SET_COMMAND_SEARCH_QUERY", payload: newQuery });
  }
};

export const processSelectorInput = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  char: string,
): void => {
  const { newInputText, newCursorPosition } = getProjectedState(state, char);

  const trigger = SELECTOR_TRIGGERS.find((t) =>
    t.shouldActivate(char, newCursorPosition, newInputText, state),
  );

  if (trigger) {
    dispatch({
      type: trigger.type,
      payload: newCursorPosition - 1,
    } as InputAction);
  } else {
    const atPos = getAtSelectorPosition(newInputText, newCursorPosition);
    let showFileSelector = state.showFileSelector;
    let atPosition = state.atPosition;
    if (atPos !== -1 && !state.showFileSelector) {
      dispatch({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: atPos,
      });
      showFileSelector = true;
      atPosition = atPos;
    }

    const slashPos = getSlashSelectorPosition(newInputText, newCursorPosition);
    let showCommandSelector = state.showCommandSelector;
    let slashPosition = state.slashPosition;
    if (slashPos !== -1 && !state.showCommandSelector) {
      dispatch({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: slashPos,
      });
      showCommandSelector = true;
      slashPosition = slashPos;
    }

    updateSearchQueriesForActiveSelectors(
      {
        ...state,
        showFileSelector,
        atPosition,
        showCommandSelector,
        slashPosition,
      },
      dispatch,
      newInputText,
      newCursorPosition,
    );
  }
};

export const getWordEnd = (text: string, startPos: number): number => {
  let i = startPos;
  while (i < text.length && !/\s/.test(text[i])) {
    i++;
  }
  return i;
};

export const expandLongTextPlaceholders = (
  text: string,
  longTextMap: Record<string, string>,
): string => {
  let expandedText = text;
  const longTextRegex = /\[LongText#(\d+)\]/g;
  const matches = [...text.matchAll(longTextRegex)];

  for (const match of matches) {
    const placeholder = match[0];
    const originalText = longTextMap[placeholder];
    if (originalText) {
      expandedText = expandedText.replace(placeholder, originalText);
    }
  }

  return expandedText;
};

// Check if the character at the given position is a selector trigger at word start
const isTriggerAtWordStart = (
  char: string,
  pos: number,
  text: string,
  state: InputState,
): boolean => {
  if (char === "@") {
    return pos === 1 || /\s/.test(text[pos - 1]);
  }
  if (char === "/") {
    return !state.showFileSelector && (pos === 1 || /\s/.test(text[pos - 1]));
  }
  return false;
};

// Process selector activation AFTER text has been inserted.
// This is used by the useEffect when the reducer has already inserted the character.
export const processSelectorAfterInsert = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  char: string,
): void => {
  const cursorPos = state.cursorPosition;
  const triggerPos = cursorPos - 1;

  // Check if the inserted character triggers a new selector
  if (
    triggerPos >= 0 &&
    isTriggerAtWordStart(char, triggerPos, state.inputText, state)
  ) {
    if (char === "@") {
      dispatch({ type: "ACTIVATE_FILE_SELECTOR", payload: triggerPos });
    } else if (char === "/") {
      dispatch({ type: "ACTIVATE_COMMAND_SELECTOR", payload: triggerPos });
    }
    return;
  }

  // Retroactive activation: check if cursor is inside an @word or /word
  const atPos = getAtSelectorPosition(state.inputText, cursorPos);
  if (atPos !== -1 && !state.showFileSelector) {
    dispatch({ type: "ACTIVATE_FILE_SELECTOR", payload: atPos });
  }

  const slashPos = getSlashSelectorPosition(state.inputText, cursorPos);
  if (slashPos !== -1 && !state.showCommandSelector) {
    dispatch({ type: "ACTIVATE_COMMAND_SELECTOR", payload: slashPos });
  }

  // Update search queries
  updateSearchQueriesForActiveSelectors(
    state,
    dispatch,
    state.inputText,
    state.cursorPosition,
  );
};
