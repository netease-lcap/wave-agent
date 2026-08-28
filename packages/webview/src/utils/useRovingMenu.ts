import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Trigger button; focus returns here on Escape / activation-close. */
  triggerRef?: RefObject<HTMLElement | null>;
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
  /**
   * Controlled menus (parent owns rendering and mounts the menu already
   * open — MoreMenu, PanelToggleMenu): in-menu close paths (activation with
   * closeOnActivate, Escape, Tab) call this instead of flipping an internal
   * flag. Click-outside and global Escape stay owned by the parent, which
   * already has its own listeners for those.
   */
  onRequestClose?: () => void;
}

/**
 * Shared keyboard model for custom dropdowns (roving tabindex): opening
 * focuses an item which becomes the single tab stop, Arrow keys move between
 * items without wrapping, Enter/Space activate via onActivate, Escape closes
 * and returns focus to the trigger button, and Tab closes the menu letting
 * focus move to the next tab stop naturally.
 *
 * Uncontrolled instances manage their own open flag (opened via openMenu,
 * closed on click-outside); controlled instances (onRequestClose) mount
 * already open and auto-focus their initial item.
 */
export function useRovingMenu(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseRovingMenuOptions,
) {
  const { itemCount, closeOnActivate, onActivate } = options;

  // Effects and event handlers read callbacks/options through a ref so the
  // hook does not re-subscribe or rebuild closures when callers pass inline
  // arrow functions (which are new on every render).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Focus target for the open effect: set by openMenu (uncontrolled) or left
  // at 0 (controlled menus mount already open and focus their first item).
  const pendingFocusRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);

  // Controlled instances have no internal open lifecycle — they exist only
  // while the parent renders them.
  const isOpen = open || options.onRequestClose !== undefined;

  const requestClose = useCallback(() => {
    if (optionsRef.current.onRequestClose) optionsRef.current.onRequestClose();
    else setOpen(false);
  }, []);

  // Roving DOM focus: index drives the rendered tabIndex values; the element
  // gets real focus so typing keys immediately land on it.
  const focusItem = useCallback(
    (index: number) => {
      setFocusIndex(index);
      containerRef.current
        ?.querySelectorAll<HTMLElement>(optionsRef.current.itemSelector)
        [index]?.focus();
    },
    [containerRef],
  );

  const openMenu = useCallback((initialIndex = 0) => {
    pendingFocusRef.current = initialIndex;
    setFocusIndex(initialIndex);
    setOpen(true);
  }, []);

  const closeMenu = useCallback(() => requestClose(), [requestClose]);

  const closeReturningFocus = useCallback(() => {
    requestClose();
    optionsRef.current.triggerRef?.current?.focus();
  }, [requestClose]);

  // Close the menu when clicking outside of it. Controlled instances let
  // their owner handle this (the owner already has its own listener).
  useEffect(() => {
    if (!isOpen || optionsRef.current.onRequestClose) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        requestClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen, containerRef, requestClose]);

  // Move real focus onto the current item once the menu is open. rAF waits
  // one frame so conditionally-rendered items exist in the DOM.
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => {
      const items = containerRef.current?.querySelectorAll<HTMLElement>(
        optionsRef.current.itemSelector,
      );
      items?.[
        Math.max(0, Math.min(pendingFocusRef.current, items.length - 1))
      ]?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, containerRef]);

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
