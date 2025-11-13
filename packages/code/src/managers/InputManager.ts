import { FileItem } from "../components/FileSelector.js";
import { searchFiles as searchFilesUtil } from "../utils/fileSearch.js";

export interface InputManagerCallbacks {
  onInputTextChange?: (text: string) => void;
  onCursorPositionChange?: (position: number) => void;
  onFileSelectorStateChange?: (
    show: boolean,
    files: FileItem[],
    query: string,
    position: number,
  ) => void;
  onCommandSelectorStateChange?: (
    show: boolean,
    query: string,
    position: number,
  ) => void;
  onBashHistorySelectorStateChange?: (
    show: boolean,
    query: string,
    position: number,
  ) => void;
  onMemoryTypeSelectorStateChange?: (show: boolean, message: string) => void;
  onShowBashManager?: () => void;
  onShowMcpManager?: () => void;
  onSendMessage?: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void | Promise<void>;
  onHasSlashCommand?: (commandId: string) => boolean;
}

export class InputManager {
  // Core input state
  private inputText: string = "";
  private cursorPosition: number = 0;

  // File selector state
  private showFileSelector: boolean = false;
  private atPosition: number = -1;
  private fileSearchQuery: string = "";
  private filteredFiles: FileItem[] = [];
  private fileSearchDebounceTimer: NodeJS.Timeout | null = null;

  // Command selector state
  private showCommandSelector: boolean = false;
  private slashPosition: number = -1;
  private commandSearchQuery: string = "";

  // Bash history selector state
  private showBashHistorySelector: boolean = false;
  private exclamationPosition: number = -1;
  private bashHistorySearchQuery: string = "";

  // Memory type selector state
  private showMemoryTypeSelector: boolean = false;
  private memoryMessage: string = "";

  // Input history state
  private userInputHistory: string[] = [];
  private historyIndex: number = -1;
  private historyBuffer: string = "";

  private callbacks: InputManagerCallbacks;

  constructor(callbacks: InputManagerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // Update callbacks
  updateCallbacks(callbacks: Partial<InputManagerCallbacks>) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // Core input methods
  getInputText(): string {
    return this.inputText;
  }

  setInputText(text: string): void {
    this.inputText = text;
    this.callbacks.onInputTextChange?.(text);
  }

  getCursorPosition(): number {
    return this.cursorPosition;
  }

  setCursorPosition(position: number): void {
    this.cursorPosition = Math.max(
      0,
      Math.min(this.inputText.length, position),
    );
    this.callbacks.onCursorPositionChange?.(this.cursorPosition);
  }

  insertTextAtCursor(
    text: string,
    callback?: (newText: string, newCursorPosition: number) => void,
  ): void {
    const beforeCursor = this.inputText.substring(0, this.cursorPosition);
    const afterCursor = this.inputText.substring(this.cursorPosition);
    const newText = beforeCursor + text + afterCursor;
    const newCursorPosition = this.cursorPosition + text.length;

    this.inputText = newText;
    this.cursorPosition = newCursorPosition;

    this.callbacks.onInputTextChange?.(newText);
    this.callbacks.onCursorPositionChange?.(newCursorPosition);

    callback?.(newText, newCursorPosition);
  }

  deleteCharAtCursor(
    callback?: (newText: string, newCursorPosition: number) => void,
  ): void {
    if (this.cursorPosition > 0) {
      const beforeCursor = this.inputText.substring(0, this.cursorPosition - 1);
      const afterCursor = this.inputText.substring(this.cursorPosition);
      const newText = beforeCursor + afterCursor;
      const newCursorPosition = this.cursorPosition - 1;

      this.inputText = newText;
      this.cursorPosition = newCursorPosition;

      this.callbacks.onInputTextChange?.(newText);
      this.callbacks.onCursorPositionChange?.(newCursorPosition);

      callback?.(newText, newCursorPosition);
    }
  }

  clearInput(): void {
    this.inputText = "";
    this.cursorPosition = 0;
    this.callbacks.onInputTextChange?.("");
    this.callbacks.onCursorPositionChange?.(0);
  }

  moveCursorLeft(): void {
    this.setCursorPosition(this.cursorPosition - 1);
  }

  moveCursorRight(): void {
    this.setCursorPosition(this.cursorPosition + 1);
  }

  moveCursorToStart(): void {
    this.setCursorPosition(0);
  }

  moveCursorToEnd(): void {
    this.setCursorPosition(this.inputText.length);
  }

  // File selector methods
  private async searchFiles(query: string): Promise<void> {
    try {
      const fileItems = await searchFilesUtil(query);
      this.filteredFiles = fileItems;
      this.callbacks.onFileSelectorStateChange?.(
        this.showFileSelector,
        this.filteredFiles,
        this.fileSearchQuery,
        this.atPosition,
      );
    } catch (error) {
      console.error("File search error:", error);
      this.filteredFiles = [];
      this.callbacks.onFileSelectorStateChange?.(
        this.showFileSelector,
        [],
        this.fileSearchQuery,
        this.atPosition,
      );
    }
  }

  private debouncedSearchFiles(query: string): void {
    if (this.fileSearchDebounceTimer) {
      clearTimeout(this.fileSearchDebounceTimer);
    }

    const debounceDelay = parseInt(
      process.env.FILE_SELECTOR_DEBOUNCE_MS || "300",
      10,
    );
    this.fileSearchDebounceTimer = setTimeout(() => {
      this.searchFiles(query);
    }, debounceDelay);
  }

  activateFileSelector(position: number): void {
    this.showFileSelector = true;
    this.atPosition = position;
    this.fileSearchQuery = "";
    this.filteredFiles = [];

    // Immediately trigger search to display initial file list
    this.searchFiles("");

    this.callbacks.onFileSelectorStateChange?.(
      true,
      this.filteredFiles,
      "",
      position,
    );
  }

  updateFileSearchQuery(query: string): void {
    this.fileSearchQuery = query;
    this.debouncedSearchFiles(query);
  }

  handleFileSelect(filePath: string): {
    newInput: string;
    newCursorPosition: number;
  } {
    if (this.atPosition >= 0) {
      const beforeAt = this.inputText.substring(0, this.atPosition);
      const afterQuery = this.inputText.substring(this.cursorPosition);
      const newInput = beforeAt + `${filePath} ` + afterQuery;
      const newCursorPosition = beforeAt.length + filePath.length + 1;

      this.inputText = newInput;
      this.cursorPosition = newCursorPosition;

      this.handleCancelFileSelect();

      this.callbacks.onInputTextChange?.(newInput);
      this.callbacks.onCursorPositionChange?.(newCursorPosition);

      return { newInput, newCursorPosition };
    }
    return { newInput: this.inputText, newCursorPosition: this.cursorPosition };
  }

  handleCancelFileSelect(): void {
    this.showFileSelector = false;
    this.atPosition = -1;
    this.fileSearchQuery = "";
    this.filteredFiles = [];

    this.callbacks.onFileSelectorStateChange?.(false, [], "", -1);
  }

  checkForAtDeletion(cursorPosition: number): boolean {
    if (this.showFileSelector && cursorPosition <= this.atPosition) {
      this.handleCancelFileSelect();
      return true;
    }
    return false;
  }

  // Command selector methods
  activateCommandSelector(position: number): void {
    this.showCommandSelector = true;
    this.slashPosition = position;
    this.commandSearchQuery = "";

    this.callbacks.onCommandSelectorStateChange?.(true, "", position);
  }

  updateCommandSearchQuery(query: string): void {
    this.commandSearchQuery = query;
    this.callbacks.onCommandSelectorStateChange?.(
      this.showCommandSelector,
      query,
      this.slashPosition,
    );
  }

  handleCommandSelect(command: string): {
    newInput: string;
    newCursorPosition: number;
  } {
    if (this.slashPosition >= 0) {
      // Replace command part, keep other content
      const beforeSlash = this.inputText.substring(0, this.slashPosition);
      const afterQuery = this.inputText.substring(this.cursorPosition);
      const newInput = beforeSlash + afterQuery;
      const newCursorPosition = beforeSlash.length;

      this.inputText = newInput;
      this.cursorPosition = newCursorPosition;

      // Execute command asynchronously
      (async () => {
        // First check if it's an agent command
        let commandExecuted = false;
        if (
          this.callbacks.onSendMessage &&
          this.callbacks.onHasSlashCommand?.(command)
        ) {
          // Execute complete command (replace partial input with complete command name)
          const fullCommand = `/${command}`;
          try {
            await this.callbacks.onSendMessage(fullCommand);
            commandExecuted = true;
          } catch (error) {
            console.error("Failed to execute slash command:", error);
          }
        }

        // If not an agent command or execution failed, check local commands
        if (!commandExecuted) {
          if (command === "bashes" && this.callbacks.onShowBashManager) {
            this.callbacks.onShowBashManager();
            commandExecuted = true;
          } else if (command === "mcp" && this.callbacks.onShowMcpManager) {
            this.callbacks.onShowMcpManager();
            commandExecuted = true;
          }
        }
      })();

      this.handleCancelCommandSelect();

      this.callbacks.onInputTextChange?.(newInput);
      this.callbacks.onCursorPositionChange?.(newCursorPosition);

      return { newInput, newCursorPosition };
    }
    return { newInput: this.inputText, newCursorPosition: this.cursorPosition };
  }

  handleCommandInsert(command: string): {
    newInput: string;
    newCursorPosition: number;
  } {
    if (this.slashPosition >= 0) {
      const beforeSlash = this.inputText.substring(0, this.slashPosition);
      const afterQuery = this.inputText.substring(this.cursorPosition);
      const newInput = beforeSlash + `/${command} ` + afterQuery;
      const newCursorPosition = beforeSlash.length + command.length + 2;

      this.inputText = newInput;
      this.cursorPosition = newCursorPosition;

      this.handleCancelCommandSelect();

      this.callbacks.onInputTextChange?.(newInput);
      this.callbacks.onCursorPositionChange?.(newCursorPosition);

      return { newInput, newCursorPosition };
    }
    return { newInput: this.inputText, newCursorPosition: this.cursorPosition };
  }

  handleCancelCommandSelect(): void {
    this.showCommandSelector = false;
    this.slashPosition = -1;
    this.commandSearchQuery = "";

    this.callbacks.onCommandSelectorStateChange?.(false, "", -1);
  }

  checkForSlashDeletion(cursorPosition: number): boolean {
    if (this.showCommandSelector && cursorPosition <= this.slashPosition) {
      this.handleCancelCommandSelect();
      return true;
    }
    return false;
  }

  // Bash history selector methods
  activateBashHistorySelector(position: number): void {
    this.showBashHistorySelector = true;
    this.exclamationPosition = position;
    this.bashHistorySearchQuery = "";

    this.callbacks.onBashHistorySelectorStateChange?.(true, "", position);
  }

  updateBashHistorySearchQuery(query: string): void {
    this.bashHistorySearchQuery = query;
    this.callbacks.onBashHistorySelectorStateChange?.(
      this.showBashHistorySelector,
      query,
      this.exclamationPosition,
    );
  }

  handleBashHistorySelect(command: string): {
    newInput: string;
    newCursorPosition: number;
  } {
    if (this.exclamationPosition >= 0) {
      const beforeExclamation = this.inputText.substring(
        0,
        this.exclamationPosition,
      );
      const afterQuery = this.inputText.substring(this.cursorPosition);
      const newInput = beforeExclamation + `!${command}` + afterQuery;
      const newCursorPosition = beforeExclamation.length + command.length + 1;

      this.inputText = newInput;
      this.cursorPosition = newCursorPosition;

      this.handleCancelBashHistorySelect();

      this.callbacks.onInputTextChange?.(newInput);
      this.callbacks.onCursorPositionChange?.(newCursorPosition);

      return { newInput, newCursorPosition };
    }
    return { newInput: this.inputText, newCursorPosition: this.cursorPosition };
  }

  handleCancelBashHistorySelect(): void {
    this.showBashHistorySelector = false;
    this.exclamationPosition = -1;
    this.bashHistorySearchQuery = "";

    this.callbacks.onBashHistorySelectorStateChange?.(false, "", -1);
  }

  handleBashHistoryExecute(command: string): string {
    this.showBashHistorySelector = false;
    this.exclamationPosition = -1;
    this.bashHistorySearchQuery = "";

    this.callbacks.onBashHistorySelectorStateChange?.(false, "", -1);

    return command; // Return command to execute
  }

  checkForExclamationDeletion(cursorPosition: number): boolean {
    if (
      this.showBashHistorySelector &&
      cursorPosition <= this.exclamationPosition
    ) {
      this.handleCancelBashHistorySelect();
      return true;
    }
    return false;
  }

  // Memory type selector methods
  activateMemoryTypeSelector(message: string): void {
    this.showMemoryTypeSelector = true;
    this.memoryMessage = message;

    this.callbacks.onMemoryTypeSelectorStateChange?.(true, message);
  }

  handleMemoryTypeSelect(type: "project" | "user"): void {
    // Note: type parameter will be used in future for different handling logic
    console.debug(`Memory type selected: ${type}`);
    this.showMemoryTypeSelector = false;
    this.memoryMessage = "";

    this.callbacks.onMemoryTypeSelectorStateChange?.(false, "");
  }

  handleCancelMemoryTypeSelect(): void {
    this.showMemoryTypeSelector = false;
    this.memoryMessage = "";

    this.callbacks.onMemoryTypeSelectorStateChange?.(false, "");
  }

  // Input history methods
  setUserInputHistory(history: string[]): void {
    this.userInputHistory = history;
  }

  navigateHistory(
    direction: "up" | "down",
    currentInput: string,
  ): { newInput: string; newCursorPosition: number } {
    if (this.historyIndex === -1) {
      this.historyBuffer = currentInput;
    }

    if (direction === "up") {
      if (this.historyIndex < this.userInputHistory.length - 1) {
        this.historyIndex++;
      }
    } else {
      // Down direction
      if (this.historyIndex > 0) {
        this.historyIndex--;
      } else if (this.historyIndex === 0) {
        // Go from first history item to draft
        this.historyIndex = -1;
      } else if (this.historyIndex === -1) {
        // Go from draft to empty (beyond history bottom)
        this.historyIndex = -2;
      }
    }

    let newInput: string;
    if (this.historyIndex === -1) {
      newInput = this.historyBuffer;
    } else if (this.historyIndex === -2) {
      // Beyond history bottom, clear input
      newInput = "";
    } else {
      const historyItem =
        this.userInputHistory[
          this.userInputHistory.length - 1 - this.historyIndex
        ];
      newInput = historyItem || "";
    }

    const newCursorPosition = newInput.length;

    this.inputText = newInput;
    this.cursorPosition = newCursorPosition;

    this.callbacks.onInputTextChange?.(newInput);
    this.callbacks.onCursorPositionChange?.(newCursorPosition);

    return { newInput, newCursorPosition };
  }

  resetHistoryNavigation(): void {
    this.historyIndex = -1;
    this.historyBuffer = "";
  }

  // Getter methods for state
  isFileSelectorActive(): boolean {
    return this.showFileSelector;
  }

  isCommandSelectorActive(): boolean {
    return this.showCommandSelector;
  }

  isBashHistorySelectorActive(): boolean {
    return this.showBashHistorySelector;
  }

  isMemoryTypeSelectorActive(): boolean {
    return this.showMemoryTypeSelector;
  }

  getFileSelectorState() {
    return {
      show: this.showFileSelector,
      files: this.filteredFiles,
      query: this.fileSearchQuery,
      position: this.atPosition,
    };
  }

  getCommandSelectorState() {
    return {
      show: this.showCommandSelector,
      query: this.commandSearchQuery,
      position: this.slashPosition,
    };
  }

  getBashHistorySelectorState() {
    return {
      show: this.showBashHistorySelector,
      query: this.bashHistorySearchQuery,
      position: this.exclamationPosition,
    };
  }

  getMemoryTypeSelectorState() {
    return {
      show: this.showMemoryTypeSelector,
      message: this.memoryMessage,
    };
  }

  // Handle special character input that might trigger selectors
  handleSpecialCharInput(char: string): void {
    if (char === "@") {
      this.activateFileSelector(this.cursorPosition - 1);
    } else if (char === "/") {
      this.activateCommandSelector(this.cursorPosition - 1);
    } else if (char === "!" && this.cursorPosition === 1) {
      this.activateBashHistorySelector(0);
    } else if (char === "#" && this.cursorPosition === 1) {
      // Memory message detection will be handled in submit
    } else {
      // Update search queries for active selectors
      if (this.showFileSelector && this.atPosition >= 0) {
        const queryStart = this.atPosition + 1;
        const queryEnd = this.cursorPosition;
        const newQuery = this.inputText.substring(queryStart, queryEnd);
        this.updateFileSearchQuery(newQuery);
      } else if (this.showCommandSelector && this.slashPosition >= 0) {
        const queryStart = this.slashPosition + 1;
        const queryEnd = this.cursorPosition;
        const newQuery = this.inputText.substring(queryStart, queryEnd);
        this.updateCommandSearchQuery(newQuery);
      } else if (
        this.showBashHistorySelector &&
        this.exclamationPosition >= 0
      ) {
        const queryStart = this.exclamationPosition + 1;
        const queryEnd = this.cursorPosition;
        const newQuery = this.inputText.substring(queryStart, queryEnd);
        this.updateBashHistorySearchQuery(newQuery);
      }
    }
  }

  // Cleanup method
  destroy(): void {
    if (this.fileSearchDebounceTimer) {
      clearTimeout(this.fileSearchDebounceTimer);
      this.fileSearchDebounceTimer = null;
    }
  }
}
