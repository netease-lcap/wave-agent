import React, { useRef } from "react";
import { isDesktopHost } from "../utils/platform";
import { useRovingMenu } from "../utils/useRovingMenu";
import {
  SELECT_MENU_ANCHOR_GAP,
  useAnchoredMenuStyle,
  useAnchorRect,
} from "../utils/anchoredMenu";

export interface SettingsSelectOption {
  value: string;
  label: string;
}

export interface SettingsSelectProps {
  /** 控件的无障碍名（原生分支落在 select 的 aria-label，自绘分支落在触发器上）。 */
  label: string;
  value: string;
  options: SettingsSelectOption[];
  disabled?: boolean;
  /**
   * 稳定测试锚点：触发器 = `${testId}`，弹层 = `${testId}-menu`，
   * 选项 = `${testId}-option-<value>`（未设置项 value 为空串时用 `unset`）。
   */
  testId: string;
  onChange: (value: string) => void;
}

/**
 * 设置页下拉选择器。
 *
 * 设计师 0921 评论：「这种类型的选择器点击后的下拉列表应该出现在选择器下方 2px 的位置，
 * 右对齐，下拉列表的宽度和选择器尽量保持一致」——原生 `<select>` 的弹层由系统/Chromium
 * 绘制（`appearance:none` 只改控件本身），**位置与尺寸都无法由 CSS 控制**，故桌面端换成
 * 自绘 listbox：`position: fixed` + 触发器 rect 定位（下缘 +2px、右缘对齐、宽度 = 触发器宽）。
 * 键盘模型复用 `useRovingMenu`（roving tabindex + Arrow/Enter/Escape/Tab），与面板内
 * 其它下拉（SSH 主机 / 工作目录 / 权限模式）同源。
 *
 * 插件端保留原生 `<select>`：弹层交给宿主原生实现，既有 e2e（`selectOption(...)`）与
 * 单测（`.settings-select` / `queryByRole("combobox")`）断言全部不受影响。
 */
export const SettingsSelect: React.FC<SettingsSelectProps> = (props) =>
  isDesktopHost() ? (
    <DesktopSettingsSelect {...props} />
  ) : (
    <select
      className="settings-select"
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

/** 菜单关闭时的占位锚点：定位 hook 必须无条件调用。 */
const EMPTY_ANCHOR_RECT = { top: 0, bottom: 0, left: 0, right: 0 };

const DesktopSettingsSelect: React.FC<SettingsSelectProps> = ({
  label,
  value,
  options,
  disabled,
  testId,
  onChange,
}) => {
  // 外层容器既是 hook 的「点击外部」边界，也是选项查询根：触发器在容器内，
  // 因此点触发器不会被当成外部点击（先关后开的抖动）。
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);

  const { open, openMenu, closeReturningFocus, getItemProps } = useRovingMenu(
    containerRef,
    {
      itemSelector: ".settings-select-option",
      itemCount: options.length,
      triggerRef,
      closeOnActivate: true,
      onActivate: (index) => {
        const next = options[index];
        if (next && next.value !== value) onChange(next.value);
      },
    },
  );

  // 弹层定位。设置卡片 `.settings-card` 是 overflow:hidden，absolute 会被裁掉，
  // 故用 fixed + 触发器 rect（与侧栏会话菜单同法）。
  //
  // 触发器位置由 `useAnchorRect` 在打开期间持续跟踪（滚动 / 缩放 / 内容回流都会重算），
  // 纵向摆放交给 `useAnchoredMenuStyle`（与侧栏会话菜单、创作集分类菜单同一套）：
  // 下方放得下就贴在触发器下缘 +2px；下方放不下、上方放得下就**整个翻到上方**；
  // 上下都放不下才收到可用高度并让菜单内部滚动。原来这里写死「始终向下」，
  // 窗口一矮（实测 700px 高时溢出视口 11px）末项就被切掉。
  const anchorRect = useAnchorRect(triggerRef, open);
  const menuStyle = useAnchoredMenuStyle(
    menuRef,
    anchorRect ?? EMPTY_ANCHOR_RECT,
    anchorRect ? anchorRect.right - anchorRect.left : 0,
    "right",
    SELECT_MENU_ANCHOR_GAP,
  );

  // 与原生 select 同一套显示语义：`value` 不在选项里时控件显示**第一项**
  // （浏览器就是这么渲染 selectedIndex = -1 的），不是空白控件。
  const current =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="settings-select-field" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="settings-select-trigger"
        data-testid={testId}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) closeReturningFocus();
          else openMenu(selectedIndex > 0 ? selectedIndex : 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            closeReturningFocus();
          }
        }}
      >
        <span className="settings-select-value">{current?.label ?? ""}</span>
      </button>
      {open && anchorRect && (
        <div
          ref={menuRef}
          className="settings-select-menu"
          role="listbox"
          aria-label={label}
          data-testid={`${testId}-menu`}
          style={menuStyle}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              className={
                "settings-select-option" +
                (option.value === value ? " is-selected" : "")
              }
              role="option"
              aria-selected={option.value === value}
              data-testid={`${testId}-option-${option.value || "unset"}`}
              {...getItemProps(index)}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
