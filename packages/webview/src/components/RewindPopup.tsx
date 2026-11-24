import React, { useEffect, useRef, useState, useCallback } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import "../styles/RewindPopup.css";

export interface RewindCheckpoint {
  id: string;
  content: string;
}

interface RewindPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  checkpoints: RewindCheckpoint[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

// CLI-style rewind picker: all checkpoints listed above the input, navigable
// with ArrowUp/ArrowDown, Enter to pick, Esc to cancel. Default selection is
// the most recent checkpoint (last in chronological order).
export const RewindPopup: React.FC<RewindPopupProps> = ({
  isVisible,
  isLoading,
  checkpoints,
  onSelect,
  onClose,
}) => {
  // 键盘/悬停选中的那一颗，连同「它是照着哪一份列表选的」一起记：列表换了一份
  // （重新加载）就回到「最后一条」，不必再靠 effect 在列表变化后改写 index ——
  // 那会先画一帧「选中第一条」再跳走。
  const [nav, setNav] = useState<{
    index: number;
    from: RewindCheckpoint[];
  } | null>(null);
  // Default selection is the most recent checkpoint (last chronologically), and
  // it is where every freshly loaded list starts again.
  const selectedIndex =
    nav && nav.from === checkpoints
      ? nav.index
      : Math.max(0, checkpoints.length - 1);
  const popupRef = useRef<HTMLDivElement>(null);

  // Grab keyboard focus while open; the container owns the keydown handler.
  useEffect(() => {
    if (isVisible) popupRef.current?.focus();
  }, [isVisible]);

  // Handle clicks outside to close popup. The listener is registered one tick
  // later (inside useClickOutside) so the mousedown that just mounted this
  // popup — e.g. clicking the /rewind entry in the slash-command popup — does
  // not immediately count as an outside click and close it.
  useClickOutside({
    refs: [popupRef],
    enabled: isVisible,
    onClickOutside: onClose,
  });

  // Auto-scroll selected item into view when navigation happens
  useEffect(() => {
    if (!popupRef.current) return;
    const selectedItem = popupRef.current.querySelector(
      ".rewind-popup-item.selected",
    );
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isVisible) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setNav({ index: Math.max(0, selectedIndex - 1), from: checkpoints });
          break;
        case "ArrowDown":
          event.preventDefault();
          setNav({
            index: Math.min(checkpoints.length - 1, selectedIndex + 1),
            from: checkpoints,
          });
          break;
        case "Enter":
          event.preventDefault();
          if (checkpoints[selectedIndex]) {
            onSelect(checkpoints[selectedIndex].id);
          }
          break;
        case "Escape":
          event.preventDefault();
          onClose();
          break;
      }
    },
    [isVisible, checkpoints, selectedIndex, onSelect, onClose],
  );

  if (!isVisible) return null;

  return (
    <div
      ref={popupRef}
      className="rewind-popup"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="rewind-popup"
    >
      <div className="rewind-popup-header">选择要回滚到的消息</div>
      {isLoading ? (
        <div className="rewind-popup-loading">
          <span className="codicon codicon-loading codicon-modifier-spin"></span>
          正在加载...
        </div>
      ) : checkpoints.length === 0 ? (
        <div className="rewind-popup-empty">没有可回滚的用户消息</div>
      ) : (
        <ul className="rewind-popup-list">
          {checkpoints.map((checkpoint, index) => (
            <li
              key={checkpoint.id}
              className={`rewind-popup-item ${index === selectedIndex ? "selected" : ""}`}
              onClick={() => onSelect(checkpoint.id)}
              onMouseEnter={() => setNav({ index, from: checkpoints })}
            >
              {checkpoint.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RewindPopup;
