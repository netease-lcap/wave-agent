import { FileItem } from "../components/FileSelector.js";
import {
  searchFiles as searchFilesUtil,
  PermissionMode,
  Logger,
  PromptHistoryManager,
} from "wave-agent-sdk";
import { readClipboardImage } from "../utils/clipboard.js";
import type { Key } from "ink";

export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
}

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
  onHistorySearchStateChange?: (show: boolean, query: string) => void;
  onBackgroundTaskManagerStateChange?: (show: boolean) => void;
  onMcpManagerStateChange?: (show: boolean) => void;
  onRewindManagerStateChange?: (show: boolean) => void;
  onImagesStateChange?: (images: AttachedImage[]) => void;
  onSendMessage?: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void | Promise<void>;
  onHasSlashCommand?: (commandId: string) => boolean;
  onAbortMessage?: () => void;
  onBackgroundCurrentTask?: () => void;
  onResetHistoryNavigation?: () => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  logger?: Logger;
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

  // History search state
  private showHistorySearch: boolean = false;
  private historySearchQuery: string = "";

  // Paste debounce state
  private pasteDebounceTimer: NodeJS.Timeout | null = null;
  private pasteBuffer: string = "";
  private initialPasteCursorPosition: number = 0;
  private isPasting: boolean = false;

  // Long text compression state
  private longTextCounter: number = 0;
  private longTextMap: Map<string, string> = new Map();

  // Image management state
  private attachedImages: AttachedImage[] = [];
  private imageIdCounter: number = 1;

  // Additional UI state
  private showBackgroundTaskManager: boolean = false;
  private showMcpManager: boolean = false;
  private showRewindManager: boolean = false;

  // Permission mode state
  private permissionMode: PermissionMode = "default";

  // Flag to prevent handleInput conflicts when selector selection occurs
  private selectorJustUsed: boolean = false;

  private callbacks: InputManagerCallbacks;
  private logger?: Logger;

  constructor(callbacks: InputManagerCallbacks = {}) {
    this.callbacks = callbacks;
    this.logger = callbacks.logger;
  }

  // Update callbacks
  updateCallbacks(callbacks: Partial<InputManagerCallbacks>) {
    this.callbacks = { ...this.callbacks, ...callbacks };
    if (callbacks.logger) {
      this.logger = callbacks.logger;
    }
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

      this.callbacks.onInputTextChange?.(newInput);
      this.callbacks.onCursorPositionChange?.(newCursorPosition);

      // Cancel file selector AFTER updating the input
      this.handleCancelFileSelect();

      // Set flag to prevent handleInput from processing the same Enter key
      this.selectorJustUsed = true;
      // Reset flag after a short delay
      setTimeout(() => {
        this.selectorJustUsed = false;
      }, 0);

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
          if (command === "tasks") {
            this.setShowBackgroundTaskManager(true);
            commandExecuted = true;
          } else if (command === "mcp") {
            this.setShowMcpManager(true);
            commandExecuted = true;
          } else if (command === "rewind") {
            this.setShowRewindManager(true);
            commandExecuted = true;
          }
        }
      })();

      this.handleCancelCommandSelect();

      // Set flag to prevent handleInput from processing the same Enter key
      this.selectorJustUsed = true;
      setTimeout(() => {
        this.selectorJustUsed = false;
      }, 0);

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

      // Set flag to prevent handleInput from processing the same Enter key
      this.selectorJustUsed = true;
      setTimeout(() => {
        this.selectorJustUsed = false;
      }, 0);

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

  // Getter methods for state
  isFileSelectorActive(): boolean {
    return this.showFileSelector;
  }

  isCommandSelectorActive(): boolean {
    return this.showCommandSelector;
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

  // Update search queries for active selectors
  private updateSearchQueriesForActiveSelectors(
    inputText: string,
    cursorPosition: number,
  ): void {
    if (this.showFileSelector && this.atPosition >= 0) {
      const queryStart = this.atPosition + 1;
      const queryEnd = cursorPosition;
      const newQuery = inputText.substring(queryStart, queryEnd);
      this.updateFileSearchQuery(newQuery);
    } else if (this.showCommandSelector && this.slashPosition >= 0) {
      const queryStart = this.slashPosition + 1;
      const queryEnd = cursorPosition;
      const newQuery = inputText.substring(queryStart, queryEnd);
      this.updateCommandSearchQuery(newQuery);
    }
  }

  // Handle special character input that might trigger selectors
  handleSpecialCharInput(char: string): void {
    if (char === "@") {
      this.activateFileSelector(this.cursorPosition - 1);
    } else if (
      char === "/" &&
      !this.showFileSelector &&
      this.cursorPosition === 1
    ) {
      // Don't activate command selector when file selector is active
      // Only activate command selector if '/' is at the start of input
      this.activateCommandSelector(this.cursorPosition - 1);
    } else {
      // Update search queries for active selectors
      this.updateSearchQueriesForActiveSelectors(
        this.inputText,
        this.cursorPosition,
      );
    }
  }

  // Long text compression methods
  generateCompressedText(originalText: string): string {
    this.longTextCounter += 1;
    const compressedLabel = `[LongText#${this.longTextCounter}]`;
    this.longTextMap.set(compressedLabel, originalText);
    return compressedLabel;
  }

  expandLongTextPlaceholders(text: string): string {
    let expandedText = text;
    const longTextRegex = /\[LongText#(\d+)\]/g;
    const matches = [...text.matchAll(longTextRegex)];

    for (const match of matches) {
      const placeholder = match[0];
      const originalText = this.longTextMap.get(placeholder);
      if (originalText) {
        expandedText = expandedText.replace(placeholder, originalText);
      }
    }

    return expandedText;
  }

  clearLongTextMap(): void {
    this.longTextMap.clear();
  }

  // Paste handling methods
  handlePasteInput(input: string): void {
    const inputString = input;

    // Detect if it's a paste operation (input contains multiple characters or newlines)
    const isPasteOperation =
      inputString.length > 1 ||
      inputString.includes("\n") ||
      inputString.includes("\r");

    if (isPasteOperation) {
      // Start or continue the debounce handling for paste operation
      if (!this.isPasting) {
        // Start new paste operation
        this.isPasting = true;
        this.pasteBuffer = inputString;
        this.initialPasteCursorPosition = this.cursorPosition;
      } else {
        // Continue paste operation, add new input to buffer
        this.pasteBuffer += inputString;
      }

      // Clear previous timer
      if (this.pasteDebounceTimer) {
        clearTimeout(this.pasteDebounceTimer);
      }

      // Set new timer, support environment variable configuration
      const pasteDebounceDelay = parseInt(
        process.env.PASTE_DEBOUNCE_MS || "30",
        10,
      );
      this.pasteDebounceTimer = setTimeout(() => {
        // Process all paste content in buffer
        let processedInput = this.pasteBuffer.replace(/\r/g, "\n");

        // Check if long text compression is needed (over 200 characters)
        if (processedInput.length > 200) {
          const originalText = processedInput;
          const compressedLabel = this.generateCompressedText(originalText);
          processedInput = compressedLabel;
        }

        this.insertTextAtCursor(processedInput);
        this.callbacks.onResetHistoryNavigation?.();

        // Reset paste state
        this.isPasting = false;
        this.pasteBuffer = "";
        this.pasteDebounceTimer = null;
      }, pasteDebounceDelay);
    } else {
      // Handle single character input
      let char = inputString;

      // Check if it's Chinese exclamation mark, convert to English if at beginning
      if (char === "！" && this.cursorPosition === 0) {
        char = "!";
      }

      this.callbacks.onResetHistoryNavigation?.();
      this.insertTextAtCursor(char, () => {
        // Handle special character input - this will manage all selectors
        this.handleSpecialCharInput(char);
      });
    }
  }

  // Image management methods
  addImage(imagePath: string, mimeType: string): AttachedImage {
    const newImage: AttachedImage = {
      id: this.imageIdCounter,
      path: imagePath,
      mimeType,
    };
    this.attachedImages = [...this.attachedImages, newImage];
    this.imageIdCounter++;
    this.callbacks.onImagesStateChange?.(this.attachedImages);
    return newImage;
  }

  removeImage(imageId: number): void {
    this.attachedImages = this.attachedImages.filter(
      (img) => img.id !== imageId,
    );
    this.callbacks.onImagesStateChange?.(this.attachedImages);
  }

  clearImages(): void {
    this.attachedImages = [];
    this.callbacks.onImagesStateChange?.(this.attachedImages);
  }

  getAttachedImages(): AttachedImage[] {
    return this.attachedImages;
  }

  async handlePasteImage(): Promise<boolean> {
    try {
      const result = await readClipboardImage();

      if (result.success && result.imagePath && result.mimeType) {
        // Add image to manager
        const attachedImage = this.addImage(result.imagePath, result.mimeType);

        // Insert image placeholder at cursor position
        this.insertTextAtCursor(`[Image #${attachedImage.id}]`);

        return true;
      }

      return false;
    } catch (error) {
      console.warn("Failed to paste image from clipboard:", error);
      return false;
    }
  }

  // Task manager state methods
  getShowBackgroundTaskManager(): boolean {
    return this.showBackgroundTaskManager;
  }

  setShowBackgroundTaskManager(show: boolean): void {
    this.showBackgroundTaskManager = show;
    this.callbacks.onBackgroundTaskManagerStateChange?.(show);
  }

  getShowMcpManager(): boolean {
    return this.showMcpManager;
  }

  setShowMcpManager(show: boolean): void {
    this.showMcpManager = show;
    this.callbacks.onMcpManagerStateChange?.(show);
  }

  getShowRewindManager(): boolean {
    return this.showRewindManager;
  }

  setShowRewindManager(show: boolean): void {
    this.showRewindManager = show;
    this.callbacks.onRewindManagerStateChange?.(show);
  }

  // Permission mode methods
  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  cyclePermissionMode(): void {
    const modes: PermissionMode[] = ["default", "acceptEdits", "plan"];
    const currentIndex = modes.indexOf(this.permissionMode);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    this.logger?.debug("Cycling permission mode", {
      from: this.permissionMode,
      to: nextMode,
    });
    this.permissionMode = nextMode;
    this.callbacks.onPermissionModeChange?.(this.permissionMode);
  }

  // Handle submit logic
  async handleSubmit(
    attachedImages: Array<{ id: number; path: string; mimeType: string }>,
    isLoading: boolean = false,
    isCommandRunning: boolean = false,
  ): Promise<void> {
    // Prevent submission during loading or command execution
    if (isLoading || isCommandRunning) {
      return;
    }

    if (this.inputText.trim()) {
      // Extract image information
      const imageRegex = /\[Image #(\d+)\]/g;
      const matches = [...this.inputText.matchAll(imageRegex)];
      const referencedImages = matches
        .map((match) => {
          const imageId = parseInt(match[1], 10);
          return attachedImages.find((img) => img.id === imageId);
        })
        .filter(
          (img): img is { id: number; path: string; mimeType: string } =>
            img !== undefined,
        )
        .map((img) => ({ path: img.path, mimeType: img.mimeType }));

      // Remove image placeholders, expand long text placeholders, send message
      let cleanContent = this.inputText.replace(imageRegex, "").trim();
      cleanContent = this.expandLongTextPlaceholders(cleanContent);

      // Save to prompt history
      PromptHistoryManager.addEntry(cleanContent).catch((err: unknown) => {
        this.logger?.error("Failed to save prompt history", err);
      });

      this.callbacks.onSendMessage?.(
        cleanContent,
        referencedImages.length > 0 ? referencedImages : undefined,
      );
      this.clearInput();
      this.callbacks.onResetHistoryNavigation?.();

      // Clear long text mapping
      this.clearLongTextMap();
    }
  }

  // Handle selector input (when any selector is active)
  handleSelectorInput(input: string, key: Key): boolean {
    if (key.backspace || key.delete) {
      if (this.cursorPosition > 0) {
        this.deleteCharAtCursor((newInput, newCursorPosition) => {
          // Check for special character deletion
          this.checkForAtDeletion(newCursorPosition);
          this.checkForSlashDeletion(newCursorPosition);

          // Update search queries using the same logic as character input
          this.updateSearchQueriesForActiveSelectors(
            newInput,
            newCursorPosition,
          );
        });
      }
      return true;
    }

    // Arrow keys, Enter and Tab should be handled by selector components
    if (key.upArrow || key.downArrow || key.return || key.tab) {
      // Let selector component handle these keys, but prevent further processing
      // by returning true (indicating we've handled the input)
      return true;
    }

    if (
      input &&
      !key.ctrl &&
      !("alt" in key && key.alt) &&
      !key.meta &&
      !key.return &&
      !key.tab &&
      !key.escape &&
      !key.leftArrow &&
      !key.rightArrow &&
      !("home" in key && key.home) &&
      !("end" in key && key.end)
    ) {
      // Handle character input for search
      this.insertTextAtCursor(input, () => {
        // Special character handling is now managed by InputManager
        this.handleSpecialCharInput(input);
      });
      return true;
    }

    return false;
  }

  // History search methods
  activateHistorySearch(): void {
    this.showHistorySearch = true;
    this.historySearchQuery = "";
    this.callbacks.onHistorySearchStateChange?.(true, "");
  }

  updateHistorySearchQuery(query: string): void {
    this.historySearchQuery = query;
    this.callbacks.onHistorySearchStateChange?.(true, query);
  }

  handleHistorySearchSelect(prompt: string): void {
    this.inputText = prompt;
    this.cursorPosition = prompt.length;
    this.callbacks.onInputTextChange?.(prompt);
    this.callbacks.onCursorPositionChange?.(prompt.length);
    this.handleCancelHistorySearch();
  }

  handleCancelHistorySearch(): void {
    this.showHistorySearch = false;
    this.historySearchQuery = "";
    this.callbacks.onHistorySearchStateChange?.(false, "");
  }

  // Handle normal input (when no selector is active)
  async handleNormalInput(
    input: string,
    key: Key,
    attachedImages: Array<{ id: number; path: string; mimeType: string }>,
    isLoading: boolean = false,
    isCommandRunning: boolean = false,
    clearImages?: () => void,
  ): Promise<boolean> {
    if (key.return) {
      await this.handleSubmit(attachedImages, isLoading, isCommandRunning);
      clearImages?.();
      return true;
    }

    if (key.escape) {
      if (this.showFileSelector) {
        this.handleCancelFileSelect();
      } else if (this.showCommandSelector) {
        this.handleCancelCommandSelect();
      }
      return true;
    }

    if (key.backspace || key.delete) {
      if (this.cursorPosition > 0) {
        this.deleteCharAtCursor();
        this.callbacks.onResetHistoryNavigation?.();

        // Check if we deleted any special characters
        const newCursorPosition = this.cursorPosition - 1;
        this.checkForAtDeletion(newCursorPosition);
        this.checkForSlashDeletion(newCursorPosition);
      }
      return true;
    }

    if (key.leftArrow) {
      this.moveCursorLeft();
      return true;
    }

    if (key.rightArrow) {
      this.moveCursorRight();
      return true;
    }

    if (("home" in key && key.home) || (key.ctrl && input === "a")) {
      this.moveCursorToStart();
      return true;
    }

    if (("end" in key && key.end) || (key.ctrl && input === "e")) {
      this.moveCursorToEnd();
      return true;
    }

    // Handle Ctrl+V for pasting images
    if (key.ctrl && input === "v") {
      this.handlePasteImage().catch((error) => {
        console.warn("Failed to handle paste image:", error);
      });
      return true;
    }

    // Handle Ctrl+R for history search
    if (key.ctrl && input === "r") {
      this.activateHistorySearch();
      return true;
    }

    // Handle Ctrl+B for backgrounding current task
    if (key.ctrl && input === "b") {
      this.callbacks.onBackgroundCurrentTask?.();
      return true;
    }

    // Handle typing input
    if (
      input &&
      !key.ctrl &&
      !("alt" in key && key.alt) &&
      !key.meta &&
      !key.return &&
      !key.escape &&
      !key.backspace &&
      !key.delete &&
      !key.leftArrow &&
      !key.rightArrow &&
      !("home" in key && key.home) &&
      !("end" in key && key.end)
    ) {
      this.handlePasteInput(input);
      return true;
    }

    return false;
  }

  // Main input handler - routes to appropriate handler based on state
  async handleInput(
    input: string,
    key: Key,
    attachedImages: Array<{ id: number; path: string; mimeType: string }>,
    isLoading: boolean = false,
    isCommandRunning: boolean = false,
    clearImages?: () => void,
  ): Promise<boolean> {
    // If selector was just used, ignore this input to prevent conflicts
    if (this.selectorJustUsed) {
      return true;
    }

    // Handle interrupt request - use Esc key to interrupt AI request or command
    if (
      key.escape &&
      (isLoading || isCommandRunning) &&
      !this.showBackgroundTaskManager &&
      !this.showMcpManager &&
      !this.showRewindManager
    ) {
      // Unified interrupt for AI message generation and command execution
      this.callbacks.onAbortMessage?.();
      return true;
    }

    // Handle Shift+Tab for permission mode cycling
    if (key.tab && key.shift) {
      this.logger?.debug("Shift+Tab detected, cycling permission mode");
      this.cyclePermissionMode();
      return true;
    }

    // Check if any selector is active
    if (
      this.showFileSelector ||
      this.showCommandSelector ||
      this.showHistorySearch ||
      this.showBackgroundTaskManager ||
      this.showMcpManager ||
      this.showRewindManager
    ) {
      if (
        this.showBackgroundTaskManager ||
        this.showMcpManager ||
        this.showRewindManager
      ) {
        // Task manager, MCP manager and Rewind don't need to handle input, handled by component itself
        // Return true to indicate we've "handled" it (by ignoring it) so it doesn't leak to normal input
        return true;
      }

      if (this.showHistorySearch) {
        if (key.escape) {
          this.handleCancelHistorySearch();
          return true;
        }
        if (key.backspace || key.delete) {
          if (this.historySearchQuery.length > 0) {
            this.updateHistorySearchQuery(this.historySearchQuery.slice(0, -1));
          }
          return true;
        }
        if (input && !key.ctrl && !key.meta && !key.return && !key.tab) {
          this.updateHistorySearchQuery(this.historySearchQuery + input);
          return true;
        }
        return true; // Let HistorySearch component handle arrows and Enter
      }

      return this.handleSelectorInput(input, key);
    } else {
      return await this.handleNormalInput(
        input,
        key,
        attachedImages,
        isLoading,
        isCommandRunning,
        clearImages,
      );
    }
  }

  // Cleanup method
  destroy(): void {
    if (this.fileSearchDebounceTimer) {
      clearTimeout(this.fileSearchDebounceTimer);
      this.fileSearchDebounceTimer = null;
    }
    if (this.pasteDebounceTimer) {
      clearTimeout(this.pasteDebounceTimer);
      this.pasteDebounceTimer = null;
    }
  }
}
