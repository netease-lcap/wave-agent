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

export const getAtSelectorPosition = (
  text: string,
  cursorPosition: number,
): number => {
  let i = cursorPosition - 1;
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === "@") {
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
      if (i === 0 || /\s/.test(text[i - 1])) {
        return i;
      }
      break;
    }
    i--;
  }
  return -1;
};

export const getWordEnd = (text: string, startPos: number): number => {
  let i = startPos;
  while (i < text.length && !/\s/.test(text[i])) {
    i++;
  }
  return i;
};

export const SELECTOR_TRIGGERS = [
  {
    char: "@",
    type: "ACTIVATE_FILE_SELECTOR" as const,
    shouldActivate: (char: string, pos: number, text: string) =>
      char === "@" && (pos === 1 || /\s/.test(text[pos - 2])),
  },
  {
    char: "/",
    type: "ACTIVATE_COMMAND_SELECTOR" as const,
    shouldActivate: (
      char: string,
      pos: number,
      text: string,
      showFileSelector: boolean,
    ) =>
      char === "/" &&
      !showFileSelector &&
      (pos === 1 || /\s/.test(text[pos - 2])),
  },
] as const;

export const getProjectedState = (
  inputText: string,
  cursorPosition: number,
  char: string,
) => {
  const beforeCursor = inputText.substring(0, cursorPosition);
  const afterCursor = inputText.substring(cursorPosition);
  const newInputText = beforeCursor + char + afterCursor;
  const newCursorPosition = cursorPosition + char.length;
  return { newInputText, newCursorPosition };
};
