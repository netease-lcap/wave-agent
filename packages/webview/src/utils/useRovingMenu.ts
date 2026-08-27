import { useCallback, useEffect, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEventHandler,
  RefObject,
} from "react";

export interface RovingMenuItemProps {
  tabIndex: number;
  onClick: MouseEventHandler<HTMLElement>;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

interface UseRovingMenuOptions {
  /** CSS selector matching the menu items inside the container. */
  itemSelector: string;
  /** Number of menu items; bounds Arrow-key roving. */
  itemCount: number;
  /** Trigger button; focus returns here on Escape. */
  triggerRef: RefObject<HTMLElement | null>;
  /**
   * When true (the usual case), activation also closes the menu and returns
   * focus to the trigger button, so onActivate stays a pure side effect
   * (post a message, run an action). Items that route focus elsewhere (like
   * opening another popup) should instead own closing inside onActivate with
   * this flag off.
   */
  closeOnActivate?: boolean;
  /** Activates the focused item (Enter/Space/click). */
  onActivate: (index: number) => void;
}

/**
 * Shared keyboard model for the message-input dropdowns (roving tabindex):
 * opening focuses an item which becomes the single tab stop, Arrow keys move
 * between items without wrapping, Enter/Space activate via onActivate,
 * Escape closes and returns focus to the trigger button, and Tab closes the
 * menu letting focus move to the next tab stop naturally. Clicking outside
 * also closes the menu.
 */
export function useRovingMenu(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseRovingMenuOptions,
) {
  const { itemSelector, itemCount, triggerRef, closeOnActivate, onActivate } =
    options;
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);

  const focusItem = useCallback(
    (index: number) => {
      setFocusIndex(index);
      containerRef.current
        ?.querySelectorAll<HTMLElement>(itemSelector)
        [index]?.focus();
    },
    [containerRef, itemSelector],
  );

  const openMenu = useCallback(
    (initialIndex = 0) => {
      setOpen(true);
      requestAnimationFrame(() => focusItem(initialIndex));
    },
    [focusItem],
  );

  const closeMenu = useCallback(() => setOpen(false), []);

  const closeReturningFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [triggerRef]);

  // Close the menu when clicking outside of it.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, containerRef]);

  const getItemProps = useCallback(
    (index: number): RovingMenuItemProps => ({
      // Roving tabindex: the focused item is the single tab stop, the rest
      // are removed from the tab order but stay arrow-key reachable.
      tabIndex: index === focusIndex ? 0 : -1,
      onClick: () => {
        onActivate(index);
        if (closeOnActivate) closeReturningFocus();
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(index);
          if (closeOnActivate) closeReturningFocus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeReturningFocus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = index + (e.key === "ArrowDown" ? 1 : -1);
          if (next >= 0 && next < itemCount) {
            focusItem(next);
          }
        } else if (e.key === "Tab") {
          // Leave the menu without activating anything; the focus moves on
          // to the next tab stop naturally.
          closeMenu();
        }
      },
    }),
    [
      focusIndex,
      onActivate,
      itemCount,
      closeOnActivate,
      closeReturningFocus,
      closeMenu,
      focusItem,
    ],
  );

  return { open, openMenu, closeMenu, closeReturningFocus, getItemProps };
}
