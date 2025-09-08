/**
 * JSON参数提取工具
 * 从不完整的JSON字符串中提取已完整的参数，返回有效的JSON对象
 */

/**
 * 从不完整的JSON字符串中提取完整的参数
 * @param incompleteJson 不完整的JSON字符串
 * @returns 包含完整参数的有效JSON对象
 */
export function extractCompleteParams(
  incompleteJson: string,
): Record<string, string | number | boolean | null> {
  if (!incompleteJson || typeof incompleteJson !== "string") {
    return {};
  }

  const result: Record<string, string | number | boolean | null> = {};

  // 匹配完整的字符串参数: "key": "value" (处理转义引号)
  // 使用更复杂的正则来匹配字符串值，包括转义字符
  const stringPattern = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = stringPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    let value = match[2];
    // 简单处理转义字符
    value = value
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
    result[key] = value;
  }

  // 匹配完整的数字参数: "key": 123 或 "key": 123.45
  const numberPattern = /"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)\s*[,}]/g;
  while ((match = numberPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    const value = parseFloat(match[2]);
    result[key] = value;
  }

  // 匹配完整的布尔参数: "key": true 或 "key": false
  const boolPattern = /"([^"]+)"\s*:\s*(true|false)\s*[,}]/g;
  while ((match = boolPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    const value = match[2] === "true";
    result[key] = value;
  }

  // 匹配完整的null参数: "key": null
  const nullPattern = /"([^"]+)"\s*:\s*null\s*[,}]/g;
  while ((match = nullPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    result[key] = null;
  }

  return result;
}
