import { useState, useEffect, useMemo } from 'react';
import { useInput } from 'ink';
import type { Message } from '../types';

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  messagesPerPage: number;
}

const MESSAGES_PER_PAGE = 5; // 固定每页显示5条消息

export const usePagination = (messages: Message[]) => {
  // 固定每页显示5条消息
  const messagesPerPage = MESSAGES_PER_PAGE;

  // 计算分页信息，自动定位到最后一页
  const paginationInfo = useMemo((): PaginationInfo => {
    const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage));
    const currentPage = totalPages; // 始终显示最后一页
    const startIndex = (currentPage - 1) * messagesPerPage;
    const endIndex = Math.min(startIndex + messagesPerPage, messages.length);

    return {
      currentPage,
      totalPages,
      startIndex,
      endIndex,
      messagesPerPage,
    };
  }, [messages.length, messagesPerPage]);

  // 手动控制的当前页（用于键盘导航）
  const [manualPage, setManualPage] = useState<number | null>(null);

  // 计算实际显示的页面信息
  const displayInfo = useMemo((): PaginationInfo => {
    if (manualPage === null) {
      return paginationInfo; // 自动模式：显示最后一页
    }

    // 手动模式：显示用户选择的页面
    const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage));
    const currentPage = Math.min(Math.max(1, manualPage), totalPages);
    const startIndex = (currentPage - 1) * messagesPerPage;
    const endIndex = Math.min(startIndex + messagesPerPage, messages.length);

    return {
      currentPage,
      totalPages,
      startIndex,
      endIndex,
      messagesPerPage,
    };
  }, [messages.length, messagesPerPage, manualPage, paginationInfo]);

  // 当消息数量变化时，如果用户没有手动导航，则重置为自动模式
  useEffect(() => {
    if (manualPage !== null) {
      // 如果用户当前在最后一页，则保持自动模式
      const totalPages = Math.ceil(messages.length / messagesPerPage);
      if (manualPage >= totalPages) {
        setManualPage(null);
      }
    }
  }, [messages.length, messagesPerPage, manualPage]);

  // 翻页功能
  const goToPage = (page: number | null) => {
    setManualPage(page);
  };

  const goToPrevPage = () => {
    const currentPage = manualPage ?? displayInfo.currentPage;
    setManualPage(Math.max(1, currentPage - 1));
  };

  const goToNextPage = () => {
    const currentPage = manualPage ?? displayInfo.currentPage;
    setManualPage(Math.min(displayInfo.totalPages, currentPage + 1));
  };

  const goToFirstPage = () => {
    setManualPage(1);
  };

  const goToLastPage = () => {
    setManualPage(null); // 返回自动模式（最后一页）
  };

  // 集成快捷键处理
  useInput((input, key) => {
    // Ctrl+U/D 快捷键
    if (key.ctrl) {
      if (input === 'u') {
        goToPrevPage();
      } else if (input === 'd') {
        goToNextPage();
      }
    }

    // Page Up/Down 支持
    if (key.pageUp) {
      goToPrevPage();
    }

    if (key.pageDown) {
      goToNextPage();
    }
  });

  return {
    displayInfo,
    manualPage,
    setManualPage,
    goToPage,
    goToPrevPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
  };
};
