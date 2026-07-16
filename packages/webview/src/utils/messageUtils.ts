import { AttachedImage } from '../types';

/**
 * 将 contenteditable 的内容转换为 Markdown 格式，并提取图片。
 * 
 * 假设 contenteditable 中的标签使用特定的 HTML 结构，例如：
 * <span class="context-tag" data-path="..." data-name="..." data-icon="..." data-is-image="...">...</span>
 */
export const convertToMarkdown = (container: HTMLElement): { markdown: string, images: AttachedImage[] } => {
  let markdown = '';
  const images: AttachedImage[] = [];

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      markdown += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      
      // Check if it's a context tag container
      if (element.classList.contains('context-tag-container')) {
        const path = element.getAttribute('data-path') || '';
        const isImage = element.getAttribute('data-is-image') === 'true';
        const isSelection = element.getAttribute('data-is-selection') === 'true';
        const imageUrl = element.getAttribute('data-image-url');
        
        if (isImage && imageUrl) {
          const placeholder = `[image${images.length + 1}]`;
          markdown += placeholder;
          images.push({
            id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            data: imageUrl,
            mimeType: imageUrl.split(';')[0].split(':')[1] || 'image/png',
            filename: element.getAttribute('data-name') || 'pasted-image.png'
          });
        } else if (isSelection) {
          const name = element.getAttribute('data-name') || '';
          const startLine = element.getAttribute('data-start-line') || '';
          const endLine = element.getAttribute('data-end-line') || '';
          markdown += `[Selection: ${path}|${name}#${startLine}-${endLine}]`;
        } else {
          markdown += `[@file:${path}]`;
        }
        return; // Important: don't traverse children
      }

      if (element.tagName === 'BR') {
        markdown += '\n';
      } else {
        // For other elements, traverse children
        Array.from(element.childNodes).forEach(traverse);
        
        // If it's a block element, ensure it ends with a newline
        const isBlock = ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL'].includes(element.tagName);
        if (isBlock) {
          if (markdown.length > 0 && !markdown.endsWith('\n')) {
            markdown += '\n';
          }
        }
      }
    }
  };

  // Use a more robust way to get content from contenteditable
  // We'll traverse the actual DOM nodes
  Array.from(container.childNodes).forEach(traverse);
  
  return { markdown: markdown.trim(), images };
};

/**
 * 解析 Markdown 中的标签语法 [@file:path], [Selection: fileName#start-end] 和 [imageN]
 */
export const parseMentions = (text: string, attachedImages?: Array<{ data: string, filename?: string }>): Array<{ type: 'text' | 'mention' | 'selection', content: string, path?: string, isImage?: boolean, fileName?: string, startLine?: string, endLine?: string, imageData?: string }> => {
  const parts: Array<{ type: 'text' | 'mention' | 'selection', content: string, path?: string, isImage?: boolean, fileName?: string, startLine?: string, endLine?: string, imageData?: string }> = [];
  // Updated regex to handle [Selection: path|fileName#start-end] or [Selection: fileName#start-end]
  const regex = /\[@file:(.*?)\]|\[Selection: (?:(.*?)\|)?(.*?)#(\d+)-(\d+)\]|\[image(\d+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
    }
    
    if (match[1]) {
      // @file mention
      const path = match[1];
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path);
      parts.push({ type: 'mention', content: match[0], path, isImage });
    } else if (match[6]) {
      // [imageN] placeholder
      const index = parseInt(match[6]) - 1;
      const attachedImage = attachedImages?.[index];
      const displayName = `图片 ${match[6]}`;
      parts.push({ 
        type: 'mention', 
        content: match[0], 
        path: displayName, 
        isImage: true,
        imageData: attachedImage?.data
      });
    } else if (match[3]) {
      // Selection
      // match[2] is path (optional), match[3] is fileName, match[4] is startLine, match[5] is endLine
      parts.push({ 
        type: 'selection', 
        content: match[0], 
        path: match[2],
        fileName: match[3], 
        startLine: match[4], 
        endLine: match[5] 
      });
    }
    
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.substring(lastIndex) });
  }

  return parts;
};
