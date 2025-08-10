/**
 * 移除代码块包裹符
 * @param content 可能包含代码块包裹符的内容
 * @returns 移除包裹符后的内容
 */
export function removeCodeBlockWrappers(content: string): string {
  // 移除开头和结尾的代码块包裹符
  // 支持以下格式：
  // ```language
  // code content
  // ```
  //
  // ```
  // code content
  // ```

  const lines = content.split('\n');
  let startIndex = 0;
  let endIndex = lines.length - 1;

  // 检查开头是否有代码块标记
  if (lines[startIndex]?.trim().startsWith('```')) {
    startIndex = 1;
  }

  // 检查结尾是否有代码块标记
  if (lines[endIndex]?.trim() === '```') {
    endIndex = endIndex - 1;
  }

  // 如果没有找到完整的代码块包裹，返回原内容
  if (startIndex === 0 && endIndex === lines.length - 1) {
    return content;
  }

  // 返回移除包裹符后的内容
  return lines.slice(startIndex, endIndex + 1).join('\n');
}
