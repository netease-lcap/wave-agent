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
