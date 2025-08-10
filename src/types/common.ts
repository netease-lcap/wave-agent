import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
  ChatCompletionChunk,
  ChatCompletionAssistantMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

// ===== Types =====

/**
 * 支持的模型ID类型
 */
export type ModelId =
  | 'claude-3-7-sonnet-20250219'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-sonnet-4-20250514'
  | 'deepseek-v3-latest'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash';

/**
 * 模型选项接口
 */
export interface ModelOption {
  id: ModelId;
  label: string;
  value: string;
}

export type Delta = ChatCompletionChunk.Choice.Delta;

export type { ChatCompletionContentPart, ChatCompletionAssistantMessageParam, ChatCompletionTool };

// The new ChatMessage type, where the user role must have content as an array.
export type ChatMessage =
  // Exclude the original user message type
  | Exclude<ChatCompletionMessageParam, { role: 'user' }>
  // Redefine the user message type with content as an array
  | (Extract<ChatCompletionMessageParam, { role: 'user' }> & {
      content: ChatCompletionContentPart[];
    });

export interface CallAgentArgs {
  files: FileTreeNode[];
  messages: ChatMessage[];
  sessionId: string;
  presetId: string;
  model?: ModelId;
  tools?: ChatCompletionTool[];
}

export interface FileTreeNode {
  label: string;
  path: string;
  children: FileTreeNode[];
  code: string;
  binaryData?: Uint8Array;
  isBinary?: boolean;
}

export type SSEData = ChatCompletionChunk.Choice.Delta | '[DONE]' | { error: boolean; message: string };

/**
 * MCP 工具接口
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP 工具调用结果接口
 */
export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * MCP 操作结果接口
 */
export interface MCPOperationResult {
  success: boolean;
  error?: string;
  tools?: MCPTool[];
  result?: MCPToolResult;
}

// ===== Constants =====

/**
 * 模型选项列表
 */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'claude-3-7-sonnet-20250219',
    label: 'Claude 3.7 Sonnet',
    value: 'claude-3-7-sonnet-20250219',
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    label: 'Claude 3.5 Sonnet',
    value: 'claude-3-5-sonnet-20241022',
  },
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    value: 'claude-sonnet-4-20250514',
  },
  {
    id: 'deepseek-v3-latest',
    label: 'DeepSeek V3',
    value: 'deepseek-v3-latest',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    value: 'gemini-2.5-pro',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    value: 'gemini-2.5-flash',
  },
];

/**
 * 支持的模型ID列表
 */
export const VALID_MODEL_IDS: ModelId[] = MODEL_OPTIONS.map((option) => option.id);

/**
 * 默认模型ID
 */
export const DEFAULT_MODEL_ID: ModelId = 'claude-sonnet-4-20250514';

// ===== Utility Functions =====

/**
 * 二进制文件扩展名列表
 */
export const binaryExtensions = [
  // 图片文件
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'webp',
  'svg',
  'sketch',
  // 音频文件
  'mp3',
  'wav',
  'ogg',
  'aac',
  // 视频文件
  'mp4',
  'webm',
  'avi',
  'mov',
  // 文档文件
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  // 压缩文件
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  // 字体文件
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  // 其他二进制文件
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
] as const;

/**
 * 检查文件是否为二进制文件
 * @param filename 文件名
 * @returns 是否为二进制文件
 */
export const isBinary = (filename: string): boolean => {
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
  return binaryExtensions.includes(ext as (typeof binaryExtensions)[number]);
};

/**
 * 移除 ANSI 颜色代码的函数
 * @param text 包含 ANSI 颜色代码的文本
 * @returns 移除颜色代码后的纯文本
 */
export const stripAnsiColors = (text: string): string => {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
};

/**
 * 根据预设过滤文件树
 */
const LOCK_FILES = [
  'package-lock.json', // npm
  'pnpm-lock.yaml', // pnpm
  'yarn.lock', // yarn
];

/**
 * 根据预设过滤文件树
 * @param files 文件树节点数组
 * @param presetId 预设ID
 * @returns 过滤后的文件树节点数组
 */
export const filterByPreset = (files: FileTreeNode[]): FileTreeNode[] => {
  const filterNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    return nodes.filter((node) => {
      if (node.children && node.children.length > 0) {
        node.children = filterNodes(node.children);
        return node.children.length > 0;
      }

      if (isBinary(node.label)) {
        delete node.binaryData;
        node.isBinary = true;
        node.code = '';
      }

      return !LOCK_FILES.includes(node.label);
    });
  };

  return filterNodes(files);
};

/**
 * 自定义 fetch，不需要特殊处理，直接使用原生 fetch
 */
export const customFetch = globalThis.fetch;

// ===== Fuzzy Replace Functions =====

/**
 * 模糊搜索函数
 * 可以处理search字符串中每行前缀缩进不准确的情况
 *
 * @param source 原始全量字符串
 * @param search 要搜索的字符串，每行前面的缩进可能不准
 * @returns 匹配内容的起始索引和结束索引，如果未找到则返回[-1, -1]
 */
export function fuzzySearch(source: string, search: string): [number, number] {
  // 处理空参数情况
  if (!source || !search) {
    return [-1, -1];
  }

  // 将源字符串和搜索字符串分割成行
  const sourceLines = source.split('\n');
  const searchLines = search.split('\n');

  // 如果搜索字符串行数大于源字符串行数，无法匹配
  if (searchLines.length > sourceLines.length) {
    return [-1, -1];
  }

  // 尝试在不同起始位置匹配
  for (let startIndex = 0; startIndex <= sourceLines.length - searchLines.length; startIndex++) {
    let isMatch = true;

    // 检查从startIndex开始的每一行是否匹配（忽略缩进）
    for (let i = 0; i < searchLines.length; i++) {
      const sourceLine = sourceLines[startIndex + i];
      const searchLine = searchLines[i];

      // 去除首尾空白比较核心内容
      const sourceContent = sourceLine.trim();
      const searchContent = searchLine.trim();

      // 如果是最后一行，支持只匹配前半部分
      if (i === searchLines.length - 1) {
        if (!sourceContent.startsWith(searchContent)) {
          isMatch = false;
          break;
        }
      } else {
        if (sourceContent !== searchContent) {
          isMatch = false;
          break;
        }
      }
    }

    // 如果匹配成功，返回起始索引和结束索引
    if (isMatch) {
      const endIndex = startIndex + searchLines.length - 1;
      return [startIndex, endIndex];
    }
  }

  // 没有找到匹配，返回[-1, -1]
  return [-1, -1];
}

/**
 * 模糊查找行号函数
 * 可以处理search字符串中每行前缀缩进不准确的情况
 *
 * @param source 原始全量字符串
 * @param search 要搜索的字符串，每行前面的缩进可能不准
 * @returns 匹配内容的起始行号（从1开始），如果未找到则返回-1
 */
export function fuzzyFindLineNumber(source: string, search: string): number {
  const [startIndex] = fuzzySearch(source, search);

  // 如果找到匹配，返回行号（从1开始）
  return startIndex !== -1 ? startIndex + 1 : -1;
}

/**
 * 模糊替换函数
 * 可以处理search字符串中每行前缀缩进不准确的情况
 *
 * @param source 原始全量字符串
 * @param search 要搜索的字符串，每行前面的缩进可能不准
 * @param replace 替换的字符串
 * @returns 替换后的全量字符串
 */
export function fuzzyReplace(source: string, search: string, replace: string): string {
  // 处理空参数情况
  if (!source || !search) {
    // 如果 source 或 search 为空，且 replace 不为空，则返回 replace
    // 否则返回 source (通常为空)
    return !source && !search && replace ? replace : source;
  }

  // 只移除首尾的换行符
  const nomalizedSearch = search.replace(/^\n+|\n+$/g, '');
  const nomalizedReplace = replace.replace(/^\n+|\n+$/g, '');

  const [startIndex] = fuzzySearch(source, nomalizedSearch);

  // 如果没有找到匹配，返回原始字符串
  if (startIndex === -1) {
    return source;
  }

  // 将源字符串分割成行
  const sourceLines = source.split('\n');
  const searchLines = nomalizedSearch.split('\n');

  // 创建替换结果
  const result = [...sourceLines];

  // 获取替换字符串的行
  const replaceLines = nomalizedSearch ? nomalizedReplace.split('\n') : [];

  // 检查最后一行是否是部分匹配
  const lastSearchLine = searchLines[searchLines.length - 1].trim();
  const lastSourceLine = sourceLines[startIndex + searchLines.length - 1].trim();
  const isPartialMatch =
    lastSearchLine && lastSourceLine && lastSourceLine.startsWith(lastSearchLine) && lastSourceLine !== lastSearchLine;

  // 如果替换字符串为空，则只删除匹配行
  if (!replace) {
    if (isPartialMatch) {
      // 部分匹配时，只删除匹配的部分，保留后面的内容
      const originalLine = sourceLines[startIndex + searchLines.length - 1];
      const lineIndent = originalLine.match(/^(\s*)/)?.[1] || '';
      const trimmedOriginalLine = originalLine.trim();
      const remainingContent = trimmedOriginalLine.substring(lastSearchLine.length);
      result[startIndex + searchLines.length - 1] = lineIndent + remainingContent;
      result.splice(startIndex, searchLines.length - 1);
    } else {
      result.splice(startIndex, searchLines.length);
    }
  }
  // 如果整个源字符串都被替换
  else if (startIndex === 0 && searchLines.length === sourceLines.length) {
    // 直接替换整个匹配区域
    result.splice(startIndex, searchLines.length, ...replaceLines);
  } else {
    // 保持替换字符串中的相对缩进
    // 获取源字符串中第一行的缩进
    const firstLineIndent = sourceLines[startIndex].match(/^(\s*)/)?.[1] || '';
    // 获取替换字符串中第一行的缩进
    const firstReplaceIndent = replaceLines[0]?.match(/^(\s*)/)?.[1] || '';

    // 替换，保持相对缩进
    const indentedReplaceLines = replaceLines.map((line) => {
      const currentLineIndent = line.match(/^(\s*)/)?.[1] || '';
      const lineContent = line.substring(currentLineIndent.length);

      // 计算当前行相对于替换内容第一行的缩进差异
      const relativeIndentLength = currentLineIndent.length - firstReplaceIndent.length;

      // 构建新的缩进：源的基准缩进 + 相对缩进差异
      let newIndent = firstLineIndent;
      if (relativeIndentLength > 0) {
        // 如果当前行比第一行缩进更多，添加额外的空格
        newIndent += ' '.repeat(relativeIndentLength);
      } else if (relativeIndentLength < 0) {
        // 如果当前行比第一行缩进更少，减少空格（但不能少于0）
        const baseIndentLength = Math.max(0, firstLineIndent.length + relativeIndentLength);
        newIndent = ' '.repeat(baseIndentLength);
      }

      return newIndent + lineContent;
    });

    if (isPartialMatch) {
      // 部分匹配时，需要特殊处理最后一行
      const originalLastLine = sourceLines[startIndex + searchLines.length - 1];
      const trimmedOriginalLine = originalLastLine.trim();
      const remainingContent = trimmedOriginalLine.substring(lastSearchLine.length);

      // 将剩余内容添加到替换内容的最后一行
      if (indentedReplaceLines.length > 0) {
        const lastReplaceLineIndent = indentedReplaceLines[indentedReplaceLines.length - 1].match(/^(\s*)/)?.[1] || '';
        const lastReplaceLineContent = indentedReplaceLines[indentedReplaceLines.length - 1].substring(
          lastReplaceLineIndent.length,
        );
        indentedReplaceLines[indentedReplaceLines.length - 1] =
          lastReplaceLineIndent + lastReplaceLineContent + remainingContent;
      }

      result.splice(startIndex, searchLines.length, ...indentedReplaceLines);
    } else {
      result.splice(startIndex, searchLines.length, ...indentedReplaceLines);
    }
  }

  return result.join('\n');
}
