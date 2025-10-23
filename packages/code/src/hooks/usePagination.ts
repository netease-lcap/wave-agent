import { useState, useEffect, useMemo } from "react";
import { useInput } from "ink";
import type { Message } from "wave-agent-sdk";
import { MESSAGES_PER_PAGE } from "../utils/constants.js";

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  messagesPerPage: number;
}

export const usePagination = (messages: Message[]) => {
  const messagesPerPage = MESSAGES_PER_PAGE;

  // Calculate pagination info, ensuring first page can be incomplete while subsequent pages are complete
  const paginationInfo = useMemo((): PaginationInfo => {
    if (messages.length <= messagesPerPage) {
      // If total messages don't exceed one page, display all messages directly
      return {
        currentPage: 1,
        totalPages: 1,
        startIndex: 0,
        endIndex: messages.length,
        messagesPerPage,
      };
    }

    // Calculate remaining messages (messages other than the first page)
    const remainingMessages = messages.length % messagesPerPage;

    if (remainingMessages === 0) {
      // Message count fits perfectly into complete pages, use standard pagination
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
      // Has remaining messages, let first page display remaining messages, subsequent pages are complete
      const firstPageMessageCount = remainingMessages;
      const totalPages = Math.floor(messages.length / messagesPerPage) + 1;

      // Default to showing the last page (complete page)
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

  // Manually controlled current page (for keyboard navigation)
  const [manualPage, setManualPage] = useState<number | null>(null);

  // Calculate actual display page info
  const displayInfo = useMemo((): PaginationInfo => {
    if (manualPage === null) {
      return paginationInfo; // Auto mode: display last page
    }

    // Manual mode: display user-selected page
    const totalPages = paginationInfo.totalPages;
    const currentPage = Math.min(Math.max(1, manualPage), totalPages);

    if (messages.length <= messagesPerPage) {
      // Only one page case
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
      // Message count fits perfectly into complete pages
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
      // First page incomplete, subsequent pages complete
      if (currentPage === 1) {
        // First page: display remaining message count
        return {
          currentPage,
          totalPages,
          startIndex: 0,
          endIndex: remainingMessages,
          messagesPerPage,
        };
      } else {
        // Other pages: display complete message count per page
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

  // When message count changes, if user hasn't manually navigated, reset to auto mode
  useEffect(() => {
    if (manualPage !== null) {
      // If user is currently on the last page, keep auto mode
      const totalPages = Math.ceil(messages.length / messagesPerPage);
      if (manualPage >= totalPages) {
        setManualPage(null);
      }
    }
  }, [messages.length, messagesPerPage, manualPage]);

  // Pagination functionality
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
    setManualPage(null); // Return to auto mode (last page)
  };

  // Integrate keyboard shortcut handling
  useInput((input, key) => {
    // Ctrl+U/D shortcuts (Vim/Less style)
    if (key.ctrl) {
      if (input === "u") {
        goToPrevPage();
      } else if (input === "d") {
        goToNextPage();
      }
    }

    // Page Up/Down support
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
