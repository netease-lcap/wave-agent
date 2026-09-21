import React, { useLayoutEffect, useRef, useState } from "react";
import { isDesktopHost } from "../utils/platform";
import { useRovingMenu } from "../utils/useRovingMenu";

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
 * IDE 宿主保留原生 `<select>`：弹层交给宿主原生实现，既有 e2e（`selectOption(...)`）与
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
  const [anchor, setAnchor] = useState<{
    top: number;
    right: number;
    width: number;
  } | null>(null);

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
  // 故用 fixed + 触发器 rect（与侧栏会话菜单同法）。设置内容区可滚动：跟随重算，
  // 避免弹层与触发器脱开。
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        top: rect.bottom + 2,
        right: window.innerWidth - rect.right,
        width: rect.width,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

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
      {open && anchor && (
        <div
          className="settings-select-menu"
          role="listbox"
          aria-label={label}
          data-testid={`${testId}-menu`}
          style={{ top: anchor.top, right: anchor.right, width: anchor.width }}
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
