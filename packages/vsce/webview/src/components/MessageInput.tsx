import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef, KeyboardEvent } from 'react';
import { convertToMarkdown } from '../utils/messageUtils';
import { ContextTag } from './ContextTag';
import { Tooltip } from './Tooltip';
import ReactDOM from 'react-dom/client';
import type { MessageInputProps, FileItem, SlashCommand, AttachedImage, PermissionMode } from '../types';
import { FileSuggestionDropdown } from './FileSuggestionDropdown';
import { SlashCommandsPopup } from './SlashCommandsPopup';
import { HistorySearchPopup } from './HistorySearchPopup';
import '../styles/MessageInput.css';
import '../styles/HistorySearchPopup.css';

interface AtMentionState {
  isActive: boolean;
  filterText: string;
  startPos: number;
  endPos: number;
}

interface SlashCommandState {
  isActive: boolean;
  filterText: string;
  startPos: number;
  endPos: number;
}

export const MessageInput = forwardRef<{ focus: () => void }, MessageInputProps>((props, ref) => {
  const {
    onSendMessage,
    disabled,
    isStreaming,
    onAbortMessage,
    onSendQueuedMessage,
    shouldClearInput,
    onInputCleared,
    vscode,
    selection: _selection,
    inputContent,
    permissionMode,
    initialAttachedImages,
    onToggleTaskList
  } = props;
  const [message, setMessage] = useState('');
  const _lastSelectionRef = useRef<Selection | null>(null);

  const handlePermissionModeSelect = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = event.target.value as PermissionMode;
    vscode.postMessage({
      command: 'setPermissionMode',
      mode: mode
    });
  }, [vscode]);

  const [atMention, setAtMention] = useState<AtMentionState>({
    isActive: false,
    filterText: '',
    startPos: 0,
    endPos: 0
  });
  const [slashCommand, setSlashCommand] = useState<SlashCommandState>({
    isActive: false,
    filterText: '',
    startPos: 0,
    endPos: 0
  });
  const [suggestions, setSuggestions] = useState<FileItem[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [slashPopupPosition, setSlashPopupPosition] = useState({ top: 0, left: 0 });
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isLoadingSlashCommands, setIsLoadingSlashCommands] = useState(false);
  const [isHistorySearchVisible, setIsHistorySearchVisible] = useState(false);
  const [historyPopupPosition, setHistoryPopupPosition] = useState({ top: 0, left: 0 });
  const [isComposing, setIsComposing] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(initialAttachedImages || []);
  
  // Store the atMention state when file upload is triggered
  const [_uploadAtMentionState, setUploadAtMentionState] = useState<AtMentionState>({ 
    isActive: false, 
    filterText: '', 
    startPos: 0, 
    endPos: 0 
  });

  const textareaRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string>('');
  const inputContentTimerRef = useRef<NodeJS.Timeout | null>(null);
  const selectionChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectionChangePosRef = useRef<number>(0);

  // Expose focus method to parent component
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }));

  // Auto-focus input on component mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);


  // Initialize message from inputContent prop
  // Use a ref to avoid re-running effect on every local message change
  const inputContentRef = useRef(inputContent);
  useEffect(() => {
    if (inputContent !== undefined && inputContent !== inputContentRef.current) {
      inputContentRef.current = inputContent;
      setMessage(inputContent);
      if (textareaRef.current) {
        textareaRef.current.innerText = inputContent;
      }
    }
  }, [inputContent]);
  
  // Initialize attached images from initialAttachedImages prop
  useEffect(() => {
    if (initialAttachedImages !== undefined) {
      setAttachedImages(initialAttachedImages);
    }
  }, [initialAttachedImages]);

  // Close dropdown helper
  const closeDropdown = useCallback(() => {
    setAtMention({ isActive: false, filterText: '', startPos: 0, endPos: 0 });
    setSuggestions([]);
    setSelectedIndex(0);
    setIsLoadingSuggestions(false);
  }, []);

  // Close 指令 popup helper
  const closeSlashCommandPopup = useCallback(() => {
    setSlashCommand({ isActive: false, filterText: '', startPos: 0, endPos: 0 });
    setSlashCommands([]);
    setSelectedSlashIndex(0);
    setIsLoadingSlashCommands(false);
  }, []);

  const closeHistorySearch = useCallback(() => {
    setIsHistorySearchVisible(false);
    if (textareaRef.current) {
      // Use setTimeout to ensure focus is returned after any other click events are processed
      const textarea = textareaRef.current;
      setTimeout(() => {
        textarea.focus();
      }, 0);
    }
  }, []);

  const handleHistorySelect = useCallback((prompt: string) => {
    if (!textareaRef.current) return;
    
    // Set the prompt as the new message
    textareaRef.current.innerText = prompt;
    setMessage(prompt);
    
    // Update extension state
    vscode.postMessage({
      command: 'updateInputContent',
      content: prompt
    });

    // Focus and move cursor to end
    textareaRef.current.focus();
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(textareaRef.current);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    
    closeHistorySearch();
  }, [vscode, closeHistorySearch]);

  // Detect 指令 in text
  const detectSlashCommand = useCallback((text: string, cursorPos: number): SlashCommandState => {
    // Find the last / symbol before cursor position
    let slashPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '/') {
        slashPos = i;
        break;
      }
      // Stop if we hit whitespace or newline
      if (text[i] === ' ' || text[i] === '\n') {
        break;
      }
    }

    if (slashPos === -1) {
      return { isActive: false, filterText: '', startPos: 0, endPos: 0 };
    }

    // Check if / is at start of line or preceded by whitespace
    const isValidPosition = slashPos === 0 || /\s/.test(text[slashPos - 1]);
    if (!isValidPosition) {
      return { isActive: false, filterText: '', startPos: 0, endPos: 0 };
    }

    // Extract filter text after /
    const afterSlash = text.slice(slashPos + 1, cursorPos);

    // Check if filter text contains invalid characters
    if (/\s/.test(afterSlash)) {
      return { isActive: false, filterText: '', startPos: 0, endPos: 0 };
    }

    return {
      isActive: true,
      filterText: afterSlash,
      startPos: slashPos,
      endPos: cursorPos
    };
  }, []);

  // Detect @ mention in text
  const detectAtMention = useCallback((text: string, cursorPos: number): AtMentionState => {
    // Find the last @ symbol before cursor position
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '@') {
        atPos = i;
        break;
      }
      // Stop if we hit whitespace or newline
      if (text[i] === ' ' || text[i] === '\n') {
        break;
      }
    }

    if (atPos === -1) {
      return { isActive: false, filterText: '', startPos: 0, endPos: 0 };
    }

    // Check if @ is at start of line or preceded by whitespace
    const charBefore = text[atPos - 1];
    const isValidPosition = atPos === 0 || /\s/.test(charBefore);
    if (!isValidPosition) {
      return { isActive: false, filterText: '', startPos: 0, endPos: 0 };
    }

    // Extract filter text after @
    const afterAt = text.slice(atPos + 1, cursorPos);

    // Check if filter text contains invalid characters
    if (/\s/.test(afterAt)) {
      return { isActive: false, filterText: '', startPos: 0, endPos: 0 };
    }

    return {
      isActive: true,
      filterText: afterAt,
      startPos: atPos,
      endPos: cursorPos
    };
  }, []);

  // Calculate dropdown position based on cursor
  const calculateDropdownPosition = useCallback(() => {
    if (!textareaRef.current) return { top: 0, left: 0 };

    const textarea = textareaRef.current;

    // Position at textarea top - CSS transform will move it up by dropdown height
    // This ensures the dropdown appears above the input with proper spacing
    return {
      top: textarea.offsetTop,
      left: textarea.offsetLeft
    };
  }, []);

  // Handle input clearing when requested by parent
  useEffect(() => {
    if (shouldClearInput) {
      setMessage('');
      // Clear persisted input content
      vscode.postMessage({
        command: 'updateInputContent',
        content: ''
      });
      setAttachedImages([]);
      closeDropdown();
      onInputCleared?.();
    }
  }, [shouldClearInput, onInputCleared, vscode, closeDropdown]);

  // Request file suggestions from extension
  const requestFileSuggestions = useCallback((filterText: string) => {
    const requestId = Date.now().toString();
    requestIdRef.current = requestId;
    setIsLoadingSuggestions(true);

    vscode.postMessage({
      command: 'requestFileSuggestions',
      filterText: filterText,
      requestId: requestId
    });
  }, [vscode]);

  // Request 指令 from extension
  const requestSlashCommands = useCallback((filterText: string) => {
    setIsLoadingSlashCommands(true);

    vscode.postMessage({
      command: 'requestSlashCommands',
      filterText: filterText
    });
  }, [vscode]);

  // Debounced file suggestion requests
  useEffect(() => {
    if (atMention.isActive) {
      const timer = setTimeout(() => {
        requestFileSuggestions(atMention.filterText);
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
    }
  }, [atMention.isActive, atMention.filterText, requestFileSuggestions]);

  // Debounced 指令 requests
  useEffect(() => {
    if (slashCommand.isActive) {
      const timer = setTimeout(() => {
        requestSlashCommands(slashCommand.filterText);
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setSlashCommands([]);
      setIsLoadingSlashCommands(false);
    }
  }, [slashCommand.isActive, slashCommand.filterText, requestSlashCommands]);

  // Handle inserting uploaded file paths into the input
  const insertUploadedFilePaths = useCallback((uploadedFiles: string[]) => {
    if (!textareaRef.current || uploadedFiles.length === 0) return;

    // Focus the input first to ensure we can work with selection
    textareaRef.current.focus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent || '';
      // Try to find the @ mention. If we have saved state, use it, otherwise look back from cursor.
      const lastAtIndex = text.lastIndexOf('@', range.startOffset - 1);
      
      if (lastAtIndex !== -1) {
        range.setStart(textNode, lastAtIndex);
        range.deleteContents();
        
        uploadedFiles.forEach((filePath) => {
          const fileName = filePath.split(/[/\\]/).pop() || filePath;
          const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fileName);
          
          const tagSpan = document.createElement('span');
          tagSpan.className = 'context-tag-container';
          tagSpan.contentEditable = 'false';
          tagSpan.setAttribute('data-path', filePath);
          tagSpan.setAttribute('data-name', fileName);
          tagSpan.setAttribute('data-is-image', String(isImage));
          tagSpan.innerText = isImage ? '[image]' : `[@file:${filePath}]`;
          
          const root = ReactDOM.createRoot(tagSpan);
          root.render(
            <ContextTag 
              name={fileName} 
              path={filePath} 
              isImage={isImage}
            />
          );
          
          range.insertNode(tagSpan);
          range.setStartAfter(tagSpan);
          
          // Add space after each tag
          const space = document.createTextNode(' ');
          range.insertNode(space);
          range.setStartAfter(space);
        });

        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        // Trigger input event to update message state
        const inputEvent = new Event('input', { bubbles: true });
        textareaRef.current?.dispatchEvent(inputEvent);
      }
    }

    // Close dropdown and clear saved state
    closeDropdown();
    setUploadAtMentionState({ isActive: false, filterText: '', startPos: 0, endPos: 0 });
  }, [closeDropdown]);

  // Handle inserting selection tags into the input
  const insertSelectionTag = useCallback((selection: { fileName: string; filePath: string; startLine: number; endLine: number; isEmpty?: boolean }) => {
    if (!textareaRef.current || !selection || selection.isEmpty) return;

    // Focus the input first to ensure we can work with selection
    textareaRef.current.focus();

    const windowSelection = window.getSelection();
    if (!windowSelection || windowSelection.rangeCount === 0) return;

    const range = windowSelection.getRangeAt(0);
    
    const fileName = selection.fileName.split(/[/\\]/).pop() || selection.fileName;
    const displayName = `${fileName}#${selection.startLine}-${selection.endLine}`;
    
    const tagSpan = document.createElement('span');
    tagSpan.className = 'context-tag-container';
    tagSpan.contentEditable = 'false';
    tagSpan.setAttribute('data-path', selection.filePath);
    tagSpan.setAttribute('data-name', fileName);
    tagSpan.setAttribute('data-start-line', String(selection.startLine));
    tagSpan.setAttribute('data-end-line', String(selection.endLine));
    tagSpan.setAttribute('data-is-selection', 'true');
    tagSpan.innerText = `[Selection: ${selection.filePath}|${fileName}#${selection.startLine}-${selection.endLine}]`;
    
    const root = ReactDOM.createRoot(tagSpan);
    root.render(
      <ContextTag 
        name={displayName} 
        path={selection.filePath} 
        onClick={() => {
          vscode.postMessage({
            command: 'openFile',
            path: selection.filePath,
            startLine: selection.startLine,
            endLine: selection.endLine
          });
        }}
      />
    );
    
    range.deleteContents();
    range.insertNode(tagSpan);
    range.setStartAfter(tagSpan);
    
    // Add space after the tag
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.setStartAfter(space);

    range.collapse(true);
    windowSelection.removeAllRanges();
    windowSelection.addRange(range);

    // Trigger input event to update message state
    const inputEvent = new Event('input', { bubbles: true });
    textareaRef.current?.dispatchEvent(inputEvent);
  }, [vscode]);

  // Listen for file suggestions response from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;

      if (data.command === 'fileSuggestionsResponse') {
        // Only process if this is the latest request
        if (data.requestId === requestIdRef.current) {
          setSuggestions(data.suggestions || []);
          // Set initial selected index: -1 if no filter text (upload option), 0 otherwise
          const hasFilterText = data.filterText && data.filterText.trim();
          setSelectedIndex(hasFilterText ? 0 : -1);
          setIsLoadingSuggestions(false);
        }
      } else if (data.command === 'fileSuggestionsError') {
        if (data.requestId === requestIdRef.current) {
          setSuggestions([]);
          setIsLoadingSuggestions(false);
          console.error('File suggestions error:', data.error);
        }
      } else if (data.command === 'slashCommandsResponse') {
        setSlashCommands(data.commands || []);
        setSelectedSlashIndex(0);
        setIsLoadingSlashCommands(false);
      } else if (data.command === 'slashCommandsError') {
        setSlashCommands([]);
        setIsLoadingSlashCommands(false);
        console.error('指令错误:', data.error);
      } else if (data.command === 'uploadSuccess') {
        // Insert uploaded file paths into the input after the @ symbol
        if (data.uploadedFiles && data.uploadedFiles.length > 0) {
          insertUploadedFilePaths(data.uploadedFiles);
        }
      } else if (data.command === 'uploadError') {
        console.error('文件上传失败:', data.error);
        // Could show an error notification here if needed
      } else if (data.command === 'addSelectionToInput') {
        insertSelectionTag(data.selection);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [insertUploadedFilePaths, insertSelectionTag, closeDropdown]);

  // Handle image preview
  const handleImagePreview = useCallback((url: string, name: string) => {
    // Create a temporary modal for image preview
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    modal.onclick = () => document.body.removeChild(modal);
    
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    img.onclick = (e) => e.stopPropagation();
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'image-preview-close';
    closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
    
    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(() => {
    // Save the current atMention state before file dialog opens
    setUploadAtMentionState(atMention);
    
    // Create a hidden file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true; // Support multiple file selection
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        // Send files to backend for upload
        const fileArray = Array.from(files);
        vscode.postMessage({
          command: 'uploadFiles',
          files: fileArray.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type
          }))
        });
        
        // Read files as base64 for upload
        const readers = fileArray.map(file => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                name: file.name,
                size: file.size,
                type: file.type,
                data: reader.result
              });
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
          });
        });
        
        Promise.all(readers).then(fileDataArray => {
          vscode.postMessage({
            command: 'uploadFilesToArtifacts',
            files: fileDataArray
          });
        }).catch(error => {
          console.error('Error reading files:', error);
          vscode.postMessage({
            command: 'showError',
            message: '读取文件失败: ' + error.message
          });
        });
      }
      
      // Cleanup
      document.body.removeChild(fileInput);
    };
    
    // Trigger file selection dialog
    document.body.appendChild(fileInput);
    fileInput.click();
    
    // Close the dropdown after triggering upload
    closeDropdown();
  }, [atMention, vscode, closeDropdown]);

  // Handle file selection
  const handleFileSelect = useCallback((file: FileItem) => {
    if (!textareaRef.current) return;

    // Handle upload option selection
    if (file.isUploadOption) {
      handleFileUpload();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    
    // Find the @ mention text node and replace it
    // This is a simplified implementation. In a real app, you'd want to be more precise.
    // For now, we'll just insert the tag at the current cursor position and remove the @mention text.
    
    // Remove the @mention text (from atMention.startPos to atMention.endPos)
    // Since we are in contenteditable, we need to find the text node.
    
    // Create the tag element
    const tagSpan = document.createElement('span');
    tagSpan.className = 'context-tag-container'; // Wrapper for React component
    tagSpan.contentEditable = 'false';
    tagSpan.setAttribute('data-path', file.relativePath);
    tagSpan.setAttribute('data-name', file.name);
    tagSpan.setAttribute('data-is-image', String(!file.isDirectory && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.name)));
    tagSpan.innerText = `[@file:${file.relativePath}]`;
    
    // Render the React component into the span
    const isImage = !file.isDirectory && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.name);
    const root = ReactDOM.createRoot(tagSpan);
    root.render(
      <ContextTag 
        name={file.name} 
        path={file.relativePath} 
        isImage={isImage}
        onClick={isImage ? () => {
          vscode.postMessage({
            command: 'previewImage',
            path: file.path
          });
        } : undefined}
      />
    );

    // Find the '@' and the filter text to delete it.
    const textNode = range.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent || '';
      const lastAtIndex = text.lastIndexOf('@', range.startOffset - 1);
      
      if (lastAtIndex !== -1) {
        // Set range to cover the '@' and filter text
        range.setStart(textNode, lastAtIndex);
        range.deleteContents();
        
        // Insert the tag
        range.insertNode(tagSpan);
        
        // Insert a space after the tag
        const space = document.createTextNode(' ');
        range.setStartAfter(tagSpan);
        range.insertNode(space);
        
        // Move cursor after the space
        range.setStartAfter(space);
        range.setEndAfter(space);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Trigger input event to update message state
        const inputEvent = new Event('input', { bubbles: true });
        textareaRef.current?.dispatchEvent(inputEvent);
      }
    }

    closeDropdown();
  }, [closeDropdown, handleFileUpload, vscode]);

  // Handle 指令 selection
  const handleSlashCommandSelect = useCallback((command: SlashCommand) => {
    if (!textareaRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;

    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent || '';
      // Find the last '/' before the cursor
      const lastSlashIndex = text.lastIndexOf('/', range.startOffset - 1);

      if (lastSlashIndex !== -1) {
        // Check if it's a valid position (start of line or preceded by whitespace)
        const charBefore = text[lastSlashIndex - 1];
        const isValidPosition = lastSlashIndex === 0 || /\s/.test(charBefore);

        if (isValidPosition) {
          // Set range to cover the '/' and any filter text
          range.setStart(textNode, lastSlashIndex);
          range.deleteContents();

          // Local commands (config/plugin/mcp) open dialog directly without inserting text
          const localCommands = ['config', 'plugin', 'mcp', 'model', 'status', 'login', 'clear'];
          if (localCommands.includes(command.name)) {
            // Restore cursor after removing the slash
            selection.removeAllRanges();
            selection.addRange(range);
            closeSlashCommandPopup();
            onSendMessage(`/${command.name}`);
            return;
          }

          // Insert the command text
          const commandText = `/${command.name} `;
          const newNode = document.createTextNode(commandText);
          range.insertNode(newNode);

          // Move cursor after the inserted text
          range.setStartAfter(newNode);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);

          // Trigger input event to update message state
          const inputEvent = new Event('input', { bubbles: true });
          textareaRef.current.dispatchEvent(inputEvent);
        }
      }
    }

    closeSlashCommandPopup();
  }, [closeSlashCommandPopup, onSendMessage]);

  const handleSend = useCallback(() => {
    if (!textareaRef.current) return;
    
    const { markdown: rawMarkdown, images: extractedImages } = convertToMarkdown(textareaRef.current);
    const markdown = rawMarkdown.replace(/\u00A0/g, ' ');
    const allImages = [...attachedImages, ...extractedImages];

    if ((markdown.trim() || allImages.length > 0) && !disabled) {
      // Convert attached images to base64 format for SDK
      const images = allImages.map(img => ({
        data: img.data, // This is already base64 data URL
        mediaType: img.mimeType
      }));
      
      onSendMessage(markdown, images.length > 0 ? images : undefined);
      
      // Clear contenteditable
      textareaRef.current.innerHTML = '';
      setMessage('');
      // Clear persisted input content
      vscode.postMessage({
        command: 'updateInputContent',
        content: ''
      });
      setAttachedImages([]);
      closeDropdown();
    }
  }, [attachedImages, disabled, onSendMessage, closeDropdown, vscode]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // Handle Shift+Tab to cycle permission mode
    if (event.key === 'Tab' && event.shiftKey && !isComposing) {
      event.preventDefault();
      const modes: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      const currentMode = permissionMode || 'default';
      const currentIndex = modes.indexOf(currentMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      const nextMode = modes[nextIndex];
      
      vscode.postMessage({
        command: 'setPermissionMode',
        mode: nextMode
      });
      return;
    }

    // Handle Ctrl+R for history search
    if (event.key === 'r' && (event.ctrlKey || event.metaKey) && !isComposing) {
      event.preventDefault();
      event.stopPropagation();
      setHistoryPopupPosition(calculateDropdownPosition());
      setIsHistorySearchVisible(true);
      return;
    }

    // Handle Ctrl+T to toggle task list
    if (event.key === 't' && (event.ctrlKey || event.metaKey) && !isComposing) {
      event.preventDefault();
      event.stopPropagation();
      onToggleTaskList?.();
      return;
    }

    // Handle 指令 navigation
    if (slashCommand.isActive && slashCommands.length > 0) {
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          setSelectedSlashIndex((prev: number) => Math.max(0, prev - 1));
          return;
        case 'ArrowDown':
          event.preventDefault();
          setSelectedSlashIndex((prev: number) => Math.min(slashCommands.length - 1, prev + 1));
          return;
        case 'Tab':
        case 'Enter':
          event.preventDefault();
          if (slashCommands[selectedSlashIndex]) {
            handleSlashCommandSelect(slashCommands[selectedSlashIndex]);
          }
          return;
        case 'Escape':
          event.preventDefault();
          closeSlashCommandPopup();
          return;
      }
    }

    // Handle dropdown navigation
    if (atMention.isActive && (suggestions.length > 0 || !atMention.filterText)) {
      const hasUploadOption = !atMention.filterText;
      const minIndex = hasUploadOption ? -1 : 0;
      const maxIndex = suggestions.length - 1;

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev: number) => Math.max(minIndex, prev - 1));
          return;
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev: number) => Math.min(maxIndex, prev + 1));
          return;
        case 'Enter':
          event.preventDefault();
          if (hasUploadOption && selectedIndex === -1) {
            // Handle upload option
            handleFileUpload();
          } else if (suggestions[selectedIndex]) {
            handleFileSelect(suggestions[selectedIndex]);
          }
          return;
        case 'Escape':
          event.preventDefault();
          if (isStreaming) {
            onAbortMessage();
          }
          closeDropdown();
          return;
      }
    }

    // Handle Esc key for interruption when focused and streaming
    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault();
      onAbortMessage();
      return;
    }

    // Normal behavior for Enter key
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault();
      
      // Check if input is empty
      const { markdown, images } = convertToMarkdown(textareaRef.current!);
      if (!markdown.trim() && images.length === 0 && onSendQueuedMessage) {
        onSendQueuedMessage();
      } else {
        handleSend();
      }
    }
  }, [slashCommand.isActive, slashCommands, selectedSlashIndex, handleSlashCommandSelect, closeSlashCommandPopup, atMention.isActive, atMention.filterText, suggestions, selectedIndex, handleFileSelect, handleFileUpload, closeDropdown, handleSend, isComposing, permissionMode, vscode, onSendQueuedMessage, onToggleTaskList, calculateDropdownPosition, isStreaming, onAbortMessage]);

  // Handle cursor position changes - debounced to wait for user to stop moving cursor
  const handleSelectionChange = useCallback(() => {
    if (!textareaRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(textareaRef.current);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    
    const cursorPos = preCaretRange.toString().length;
    
    // Skip if cursor position hasn't changed (avoid redundant work)
    if (cursorPos === lastSelectionChangePosRef.current) {
      return;
    }
    lastSelectionChangePosRef.current = cursorPos;

    // Debounce: reset timer on each cursor change, only execute when user stops
    if (selectionChangeTimerRef.current) {
      clearTimeout(selectionChangeTimerRef.current);
    }

    selectionChangeTimerRef.current = setTimeout(() => {
      if (!textareaRef.current) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const rng = sel.getRangeAt(0);
      const pre = rng.cloneRange();
      pre.selectNodeContents(textareaRef.current!);
      pre.setEnd(rng.endContainer, rng.endOffset);
      
      const textBeforeCursor = pre.toString();

      // Use textBeforeCursor for detection as it's more reliable for cursor position
      const mentionState = detectAtMention(textBeforeCursor, textBeforeCursor.length);
      const slashCommandState = detectSlashCommand(textBeforeCursor, textBeforeCursor.length);

      if (!mentionState.isActive) {
        closeDropdown();
      } else {
        setAtMention(mentionState);
        setDropdownPosition(calculateDropdownPosition());
      }

      if (!slashCommandState.isActive) {
        closeSlashCommandPopup();
      } else {
        setSlashCommand(slashCommandState);
        setSlashPopupPosition(calculateDropdownPosition());
      }
      selectionChangeTimerRef.current = null;
    }, 100);
  }, [detectAtMention, detectSlashCommand, closeDropdown, closeSlashCommandPopup, calculateDropdownPosition]);

  const handleInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const newValue = target.innerText;

    setMessage(newValue);

    // Debounce sending updated content to extension for persistence
    if (inputContentTimerRef.current) {
      clearTimeout(inputContentTimerRef.current);
    }
    inputContentTimerRef.current = setTimeout(() => {
      vscode.postMessage({
        command: 'updateInputContent',
        content: target.innerText
      });
      inputContentTimerRef.current = null;
    }, 150);

    // Debounced selection change detection (for @mention and /command)
    handleSelectionChange();
  }, [handleSelectionChange, vscode]);

  // Handle IME composition events
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  // Image handling functions
  const createDataUrlFromBlob = useCallback((blob: Blob, _filename: string): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.readAsDataURL(blob);
    });
  }, []);

  const handleImagePaste = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    
    for (const file of imageFiles) {
      try {
        const dataUrl = await createDataUrlFromBlob(file, file.name);
        
        // Insert inline tag for the image
        if (!textareaRef.current) continue;
        
        // Count existing images in the input to determine the next index
        const existingImageTags = textareaRef.current.querySelectorAll('.context-tag-container[data-is-image="true"]');
        const nextIndex = existingImageTags.length + 1;
        const displayName = `图片 ${nextIndex}`;
        
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) continue;
        
        const range = selection.getRangeAt(0);
        
        const tagSpan = document.createElement('span');
        tagSpan.className = 'context-tag-container';
        tagSpan.contentEditable = 'false';
        tagSpan.setAttribute('data-path', `pasted-image-${Date.now()}.png`);
        
        tagSpan.setAttribute('data-name', displayName);
        tagSpan.setAttribute('data-is-image', 'true');
        tagSpan.setAttribute('data-image-url', dataUrl);
        tagSpan.innerText = `[image]`;
        
        const root = ReactDOM.createRoot(tagSpan);
        root.render(
          <ContextTag 
            name={displayName} 
            path={`pasted-image-${Date.now()}.png`} 
            isImage={true}
            onClick={() => handleImagePreview(dataUrl, displayName)}
          />
        );
        
        range.deleteContents();
        range.insertNode(tagSpan);
        
        // Insert a space after the tag
        const space = document.createTextNode(' ');
        range.setStartAfter(tagSpan);
        range.insertNode(space);
        range.setStartAfter(space);
        range.setEndAfter(space);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Trigger input event to update message state
        const inputEvent = new Event('input', { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);
        
      } catch (error) {
        console.error('Failed to process image:', error);
      }
    }
  }, [createDataUrlFromBlob, textareaRef, handleImagePreview]);

  const _handleRemoveImage = useCallback((imageId: string) => {
    setAttachedImages((prev: AttachedImage[]) => prev.filter((img: AttachedImage) => img.id !== imageId));
  }, []);

  // Paste event handler
  const handlePaste = useCallback((event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      const fileList = new DataTransfer();
      files.forEach(file => fileList.items.add(file));
      handleImagePaste(fileList.files);
    } else {
      // Handle text paste to avoid rich text styles
      const text = event.clipboardData?.getData('text/plain');
      if (text) {
        event.preventDefault();
        
        // Fallback to manual insertion as execCommand('insertText') is unreliable in some environments
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          
          // Move cursor to the end of inserted text
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          selection.removeAllRanges();
          selection.addRange(range);
          
          // Trigger input event manually to update React state
          const inputEvent = new Event('input', { bubbles: true });
          textareaRef.current?.dispatchEvent(inputEvent);
        }
      }
    }
  }, [handleImagePaste]);

  // Add event listeners for paste only
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pasteHandler = (e: ClipboardEvent) => handlePaste(e);

    textarea.addEventListener('paste', pasteHandler);

    return () => {
      textarea.removeEventListener('paste', pasteHandler);
    };
  }, [handlePaste]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (inputContentTimerRef.current) {
        clearTimeout(inputContentTimerRef.current);
      }
      if (selectionChangeTimerRef.current) {
        clearTimeout(selectionChangeTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="input-container" data-testid="input-container">
      <div className="input-wrapper">
        {/* ContentEditable - full width */}
        <div
          ref={textareaRef}
          id="messageInput"
          className="message-input content-editable-input"
          contentEditable={!disabled}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onSelect={handleSelectionChange}
          onClick={handleSelectionChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          data-testid="message-input"
          data-placeholder="输入 / 发送指令，输入 @ 添加上下文，或粘贴图片..."
        />

        {/* Buttons row */}
        <div className="input-buttons-row">
          {/* Left side - Permission Mode Select */}
          <div className="permission-mode-container">
            <Tooltip text="权限模式" position="top">
              <select 
                className={`permission-mode-select mode-${permissionMode || 'default'}`}
                value={permissionMode || 'default'}
                onChange={handlePermissionModeSelect}
                aria-label="权限模式"
              >
                <option value="default">修改前询问</option>
                <option value="acceptEdits">自动接受修改</option>
                <option value="bypassPermissions">跳过权限确认</option>
                <option value="plan">计划模式</option>
              </select>
            </Tooltip>
          </div>

          <div className="button-spacer" />

          <Tooltip text="停止" position="top">
            <button
              className="abort-button"
              id="abortButton"
              onClick={onAbortMessage}
              style={{ display: isStreaming ? 'block' : 'none' }}
              data-testid="abort-btn"
              aria-label="停止"
            >
              <i className="codicon codicon-stop-circle"></i>
            </button>
          </Tooltip>

          <Tooltip text={isStreaming ? "加入队列" : "发送"} position="top-left">
            <button
              id="sendButton"
              className="send-button"
              onClick={handleSend}
              disabled={disabled || (!message.trim() && attachedImages.length === 0)}
              data-testid="send-btn"
              aria-label={isStreaming ? "加入队列" : "发送"}
            >
              <i className={`codicon ${isStreaming ? 'codicon-list-ordered' : 'codicon-arrow-up'}`}></i>
            </button>
          </Tooltip>
        </div>

        {/* File Suggestion Dropdown */}
        <FileSuggestionDropdown
          suggestions={suggestions}
          isVisible={!!(atMention.isActive && (suggestions.length > 0 || isLoadingSuggestions || !atMention.filterText))}
          selectedIndex={selectedIndex}
          onSelect={handleFileSelect}
          onClose={closeDropdown}
          position={dropdownPosition}
          filterText={atMention.filterText}
          isLoading={isLoadingSuggestions}
        />

        {/* 指令弹窗 */}
        <SlashCommandsPopup
          commands={slashCommands}
          isVisible={slashCommand.isActive && (slashCommands.length > 0 || isLoadingSlashCommands)}
          selectedIndex={selectedSlashIndex}
          onSelect={handleSlashCommandSelect}
          onClose={closeSlashCommandPopup}
          position={slashPopupPosition}
          isLoading={isLoadingSlashCommands}
        />

        {/* 历史记录搜索弹窗 */}
        <HistorySearchPopup
          isVisible={isHistorySearchVisible}
          onSelect={handleHistorySelect}
          onClose={closeHistorySearch}
          position={historyPopupPosition}
          vscode={vscode}
        />
      </div>
    </div>
  );
});