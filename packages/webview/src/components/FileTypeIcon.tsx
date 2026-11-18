import React from "react";
import {
  FILE_ICON_GRADIENTS,
  FILE_ICON_PALETTE,
  FILE_ICON_SHAPES,
  fileIconFor,
} from "./pierreFileIcons";
import "../styles/FileTypeIcon.css";

/**
 * 文件类型图标（spec desktop-file-panel.md「文件行按类型显示图标」）。
 *
 * 数据在 `pierreFileIcons.ts`（图标集见那里与 `THIRD_PARTY_NOTICES.md`），这里只
 * 负责把一颗图标画出来：
 * - 尺寸默认 16px，与文件树行高 22px、原来 `PanelKindIcon kind="file"` 的盒子一致
 *   ⇒ 行内零位移。
 * - 颜色走图标集自带的 `[浅色, 深色]` 一对，由 `--fti-light` / `--fti-dark` 两个
 *   内联 CSS 变量交给样式表，`<html data-theme>` 一变就换色——不需要 React 重渲染
 *  （宿主切主题只改 DOM 属性，不触发重渲染，见 ChatApp 的 `desktopThemeChange`）。
 * - 数据集里没有配色的几颗（`font` / `stylelint` / `nextjs`）不写变量，回落到
 *   `currentColor`，也就是原来那层 `--cc-text-secondary`。
 * - `nextjs` 的斜线面是渐变（数据集里唯一的 `<linearGradient>`）：渐变 id 由
 *   `useId` 按实例生成，同一屏多颗 nextjs 图标不会撞 id。
 */
export const FileTypeIcon: React.FC<{
  /** 文件名（可含扩展名的多点串，如 `a.d.ts`）；不看目录。 */
  fileName: string;
  /** 盒宽高（px），默认 16。 */
  size?: number;
  className?: string;
}> = ({ fileName, size = 16, className }) => {
  const name = fileIconFor(fileName);
  const palette = FILE_ICON_PALETTE[name];
  const gradient = FILE_ICON_GRADIENTS[name];
  // useId 生成的串含 `:` / `«»`，塞进 url(#…) 前要洗成 CSS 标识符。
  const gradientId = `fti-grad-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      data-file-type-icon={name}
      className={className ? `file-type-icon ${className}` : "file-type-icon"}
      style={
        palette
          ? ({
              "--fti-light": palette[0],
              "--fti-dark": palette[1],
            } as React.CSSProperties)
          : undefined
      }
    >
      {gradient && (
        <defs>
          <linearGradient
            id={gradientId}
            x1={gradient.x1}
            y1={gradient.y1}
            x2={gradient.x2}
            y2={gradient.y2}
            gradientUnits="userSpaceOnUse"
          >
            {gradient.stops.map((stop, index) => (
              <stop
                key={index}
                offset={stop.offset}
                stopColor="var(--fti-fill)"
                stopOpacity={stop.stopOpacity}
              />
            ))}
          </linearGradient>
        </defs>
      )}
      {FILE_ICON_SHAPES[name].map((shape, index) => (
        <path
          key={index}
          d={shape.d}
          fill={
            shape.fill === "gradient"
              ? `url(#${gradientId})`
              : "var(--fti-fill)"
          }
          opacity={shape.opacity}
          fillRule={shape.fillRule}
          clipRule={shape.clipRule}
        />
      ))}
    </svg>
  );
};
