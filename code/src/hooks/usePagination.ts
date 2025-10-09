import { useState, useEffect, useMemo } from "react";
import { useInput } from "ink";
import type { Message } from "wave-agent-sdk";
import { MESSAGES_PER_PAGE } from "wave-agent-sdk";

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  messagesPerPage: number;
}

export const usePagination = (messages: Message[]) => {
  const messagesPerPage = MESSAGES_PER_PAGE;

  // 计算分页信息，确保第一页可以不完整，之后的页面都完整
  const paginationInfo = useMemo((): PaginationInfo => {
    if (messages.length <= messagesPerPage) {
      // 如果消息总数不超过一页，直接显示所有消息
      return {
        currentPage: 1,
        totalPages: 1,
        startIndex: 0,
        endIndex: messages.length,
        messagesPerPage,
      };
    }

    // 计算剩余消息数量（除了第一页之外的消息）
    const remainingMessages = messages.length % messagesPerPage;

    if (remainingMessages === 0) {
      // 消息数量刚好可以完整分页，使用标准分页
      const totalPages = Math.ceil(messages.length / messagesPerPage);
      const currentPage = totalPages;
      const startIndex = (currentPage - 1) * messagesPerPage;
      const endIndex = messages.length;

      return {
        currentPage,
        totalPages,
        startIndex,
        endIndex,
        messagesPerPage,
      };
    } else {
      // 有剩余消息，让第一页显示剩余的消息，后面的页面都完整
      const firstPageMessageCount = remainingMessages;
      const totalPages = Math.floor(messages.length / messagesPerPage) + 1;

      // 默认显示最后一页（完整页面）
      const currentPage = totalPages;
      const startIndex =
        firstPageMessageCount + (currentPage - 2) * messagesPerPage;
      const endIndex = messages.length;

      return {
        currentPage,
        totalPages,
        startIndex,
        endIndex,
        messagesPerPage,
      };
    }
  }, [messages.length, messagesPerPage]);

  // 手动控制的当前页（用于键盘导航）
  const [manualPage, setManualPage] = useState<number | null>(null);

  // 计算实际显示的页面信息
  const displayInfo = useMemo((): PaginationInfo => {
    if (manualPage === null) {
      return paginationInfo; // 自动模式：显示最后一页
    }

    // 手动模式：显示用户选择的页面
    const totalPages = paginationInfo.totalPages;
    const currentPage = Math.min(Math.max(1, manualPage), totalPages);

    if (messages.length <= messagesPerPage) {
      // 只有一页的情况
      return {
        currentPage,
        totalPages,
        startIndex: 0,
        endIndex: messages.length,
        messagesPerPage,
      };
    }

    const remainingMessages = messages.length % messagesPerPage;

    if (remainingMessages === 0) {
      // 消息数量刚好可以完整分页
      const startIndex = (currentPage - 1) * messagesPerPage;
      const endIndex = Math.min(startIndex + messagesPerPage, messages.length);

      return {
        currentPage,
        totalPages,
        startIndex,
        endIndex,
        messagesPerPage,
      };
    } else {
      // 第一页不完整，后面的页面完整
      if (currentPage === 1) {
        // 第一页：显示剩余的消息数量
        return {
          currentPage,
          totalPages,
          startIndex: 0,
          endIndex: remainingMessages,
          messagesPerPage,
        };
      } else {
        // 其他页面：每页显示完整的消息数量
        const firstPageMessageCount = remainingMessages;
        const startIndex =
          firstPageMessageCount + (currentPage - 2) * messagesPerPage;
        const endIndex = Math.min(
          startIndex + messagesPerPage,
          messages.length,
        );

        return {
          currentPage,
          totalPages,
          startIndex,
          endIndex,
          messagesPerPage,
        };
      }
    }
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
    // Ctrl+B/F 快捷键 (Vim/Less 风格)
    if (key.ctrl) {
      if (input === "b") {
        goToPrevPage();
      } else if (input === "f") {
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
