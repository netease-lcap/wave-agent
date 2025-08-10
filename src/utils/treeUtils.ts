import type { FileTreeNode } from '../types/common';

/**
 * 计算文件树的深度
 * @param nodes 文件树节点数组
 * @returns 树的最大深度
 */
export const calculateTreeDepth = (nodes: FileTreeNode[]): number => {
  if (nodes.length === 0) return 0;
  let maxDepth = 1;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      maxDepth = Math.max(maxDepth, 1 + calculateTreeDepth(node.children));
    }
  }
  return maxDepth;
};

/**
 * 对文件树节点进行排序（目录在前，文件在后，同类型按名称排序）
 * @param nodes 要排序的节点数组
 * @returns 排序后的节点数组
 */
export const sortTreeNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
  return [...nodes].sort((a, b) => {
    // Sort directories first, then files
    if (a.children.length > 0 && b.children.length === 0) return -1;
    if (a.children.length === 0 && b.children.length > 0) return 1;
    return a.label.localeCompare(b.label);
  });
};
