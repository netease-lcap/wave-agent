import type { FileTreeNode } from '../types/common';

/**
 * 将文件树扁平化为文件列表
 * @param nodes 文件树节点数组
 * @returns 扁平化的文件节点数组
 */
export const flattenFiles = (nodes: FileTreeNode[]): FileTreeNode[] => {
  const result: FileTreeNode[] = [];

  const traverse = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        // This is a directory, traverse its children
        traverse(node.children);
      } else {
        // This is a file, add it to result
        result.push(node);
      }
    }
  };

  traverse(nodes);
  return result;
};
