import React, { useCallback, useRef } from "react";
import type { ConfiguredModel } from "wave-webview-fixtures";
import { useRovingMenu } from "../utils/useRovingMenu";
import { ModelBrainIcon, PermCaretIcon } from "./HeaderIcons";
import { Tooltip } from "./Tooltip";
import { isDesktopHost } from "../utils/platform";
import "../styles/ModelPicker.css";

export interface ModelPickerProps {
  /** 宿主下发的可选模型清单（启动时拉一次，切会话时重拉）。 */
  models: ConfiguredModel[];
  /** 当前会话使用的模型；清单还没回来时为空。 */
  currentModel?: string;
  disabled?: boolean;
  /**
   * 底栏空间不足时的「图标档」（1023 评论：参考 codex，模型与权限都只显示图标）。
   * 只由 MessageInput 的底栏量宽决定；为真时按钮收成 32×32 的大脑图标，
   * 模型名与漏斗尖都藏起来，点击行为不变（仍向上展开同一个列表）。
   */
  compact?: boolean;
  onSelect: (model: string) => void;
}

/** IDE 宿主沿用的细描边 chevron（与改动前逐字一致；桌面端改用共享的 PermCaretIcon）。 */
const ChevronIcon: React.FC = () => (
  <svg
    className="model-picker-caret"
    width="8"
    height="5"
    viewBox="0 0 8 5"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M1 1l3 3 3-3"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg
    className="model-picker-check"
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3 8.5l3.2 3L13 4.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 输入卡片底栏左侧的模型选择器（spec ui/model-selection.md「输入卡片底栏切换
 * 模型」）：按钮回显当前会话的模型名，点开向上展开单选列表，当前项带勾选，
 * 支持视觉的模型带「视觉」标识。
 *
 * 键盘模型与权限模式下拉共用 `useRovingMenu`（↑↓ 移动、Enter 选中、Esc 归位到
 * 触发按钮、Tab 直接离开）；原生 `<select>` 在 JCEF 里会被视口底部裁掉，所以
 * 三端统一用这个自定义下拉。
 */
export const ModelPicker: React.FC<ModelPickerProps> = ({
  models,
  currentModel,
  disabled,
  compact = false,
  onSelect,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedIndex = Math.max(
    0,
    models.findIndex((m) => m.name === currentModel),
  );

  const menu = useRovingMenu(menuRef, {
    itemSelector: ".model-picker-item",
    itemCount: models.length,
    triggerRef,
    closeOnActivate: true,
    onActivate: (i) => {
      const model = models[i];
      // 点当前模型 = 什么都不用做（不重复写配置）。
      if (model && model.name !== currentModel) onSelect(model.name);
    },
  });

  const openMenu = useCallback(() => {
    menu.openMenu(selectedIndex);
  }, [menu, selectedIndex]);

  const label = currentModel ?? (models.length > 0 ? models[0].name : "");
  const open = menu.open;

  // 没有可选模型（清单未回 / 宿主没配）时按钮不渲染：底栏不留一个点不开的空控件。
  if (models.length === 0) return null;

  const triggerButton = (
    <button
      type="button"
      ref={triggerRef}
      className="model-picker-trigger"
      data-testid="model-picker-trigger"
      aria-label={label ? `模型：${label}` : "模型"}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => {
        if (open) menu.closeMenu();
        else openMenu();
      }}
    >
      {/* 图标档的大脑图标：文字档下 display:none（不占位），
          由底栏的 `.is-compact` 切换显示（见 host-desktop.css）。 */}
      {isDesktopHost() && <ModelBrainIcon className="model-picker-icon" />}
      <span className="model-picker-name" title={label}>
        {label}
      </span>
      {isDesktopHost() ? (
        <PermCaretIcon className="model-picker-caret" />
      ) : (
        <ChevronIcon />
      )}
    </button>
  );

  return (
    <div className="model-picker-container" ref={menuRef}>
      {/* 图标档只有一颗大脑，含义不是不言自明的 → 补可见气泡（icon.md：
          「Icon-only buttons require an accessible name and a visible tooltip」）。
          文字档不包，避免给常规态多套一层（保持零位移）。 */}
      {compact ? (
        <Tooltip text={`切换模型 · ${label}`} position="top">
          {triggerButton}
        </Tooltip>
      ) : (
        triggerButton
      )}
      {open && (
        <ul
          className="model-picker-menu"
          data-testid="model-picker-menu"
          role="listbox"
          aria-label="选择模型"
        >
          {models.map((model, i) => {
            const selected = model.name === currentModel;
            return (
              <li
                key={model.name}
                role="option"
                data-value={model.name}
                data-testid={`model-picker-item-${model.name}`}
                aria-selected={selected}
                title={model.name}
                className={`model-picker-item${selected ? " selected" : ""}`}
                {...menu.getItemProps(i)}
              >
                <span className="model-picker-item-name">{model.name}</span>
                {model.supportsVision && (
                  <span className="model-picker-vision">视觉</span>
                )}
                {selected && <CheckIcon />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ModelPicker;
