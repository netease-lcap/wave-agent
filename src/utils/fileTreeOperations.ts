import * as path from 'path';
import type { FileTreeNode } from '../types/common';
import { sortTreeNodes } from './treeUtils';

/**
 * 在文件树中更新指定文件的内容
 * @param nodes 文件树节点数组
 * @param filePath 文件路径
 * @param content 新的文件内容
 * @returns 更新后的文件树节点数组
 */
export const updateFileInTree = (nodes: FileTreeNode[], filePath: string, content?: string): FileTreeNode[] => {
  return nodes.map((node) => {
    if (node.path === filePath) {
      // Update the file
      return {
        ...node,
        code: content || '',
      };
    } else if (node.children.length > 0) {
      // Check if this is a parent directory
      if (filePath.startsWith(node.path + '/')) {
        return {
          ...node,
          children: updateFileInTree(node.children, filePath, content),
        };
      }
    }
    return node;
  });
};

/**
 * 从文件树中移除指定路径的文件或目录
 * @param nodes 文件树节点数组
 * @param targetPath 要移除的路径
 * @returns 移除后的文件树节点数组
 */
export const removeFromTree = (nodes: FileTreeNode[], targetPath: string): FileTreeNode[] => {
  return nodes
    .filter((node) => node.path !== targetPath && !node.path.startsWith(targetPath + '/'))
    .map((node) => ({
      ...node,
      children: node.children.length > 0 ? removeFromTree(node.children, targetPath) : [],
    }));
};

/**
 * 向文件树中添加文件
 * @param nodes 文件树节点数组
 * @param targetPath 文件路径
 * @param content 文件内容
 * @returns 更新后的文件树节点数组
 */
export const addFileToTree = (nodes: FileTreeNode[], targetPath: string, content: string): FileTreeNode[] => {
  const fileName = path.basename(targetPath);
  const dirPath = path.dirname(targetPath);

  const addToTreeRecursive = (nodes: FileTreeNode[], currentPath = ''): FileTreeNode[] => {
    if (currentPath === dirPath || (dirPath === '.' && currentPath === '')) {
      // Add to this level
      const newFile: FileTreeNode = {
        label: fileName,
        path: targetPath,
        code: content,
        children: [],
      };

      // Check if file already exists
      const existingIndex = nodes.findIndex((node) => node.path === targetPath);
      if (existingIndex !== -1) {
        // Update existing file
        const newNodes = [...nodes];
        newNodes[existingIndex] = newFile;
        return newNodes;
      } else {
        // Add new file
        return sortTreeNodes([...nodes, newFile]);
      }
    } else {
      // Look for the parent directory
      return nodes.map((node) => {
        if (targetPath.startsWith(node.path + '/')) {
          return {
            ...node,
            children: addToTreeRecursive(node.children, node.path),
          };
        }
        return node;
      });
    }
  };

  return addToTreeRecursive(nodes);
};

/**
 * 递归查找文件树中指定路径的文件
 * @param nodes 文件树节点数组
 * @param targetPath 目标文件路径
 * @returns 找到的文件节点，如果未找到则返回null
 */
export const findFileInTree = (nodes: FileTreeNode[], targetPath: string): FileTreeNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }
    if (node.children && node.children.length > 0) {
      const found = findFileInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
};
