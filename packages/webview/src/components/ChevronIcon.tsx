import React from "react";

/**
 * 官方 Figma chevron 矢量（13498:16662「上」/ 13561:39968「右」），展开态用「上」这条
 * 绕盒心转 180° 得到「下」（产品里所有披露控件的语义方向都是 expanded→down，见
 * DiffPane / DiffFileTree）。与 0921 设置页下拉三角「同一条官方矢量翻转」同一做法。
 *
 * 侧栏会话分组头（`desktop-session-group-chevron`）与文件面板目录树的展开箭头共用
 * 这一份路径，两处箭头因此是**逐像素同源**的同一个字形；1029 第八轮设计师反馈树里的
 * codicon chevron 比侧栏那颗大一圈，改用同源矢量后墨迹完全一致。
 *
 * 与 codicon 字形的差别：不依赖图标字体（内联 SVG），尺寸可按盒线性缩放（字体字形
 * 在 12/13px 之间会被 hinting 抹平），也因此不再与 DiffPane / DiffFileTree 的
 * `codicon-chevron-*` 同源 —— 那两处是列表/差异树的折叠箭头，未纳入本次统一。
 */
export const ChevronIcon: React.FC<{
  expanded: boolean;
  /**
   * 盒宽高（px）。默认 16：与侧栏分组头同尺寸（该处墨迹 8.0×5.0px）。
   */
  size?: number;
  className?: string;
}> = ({ expanded, size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className={className}
    style={{ display: "block", flexShrink: 0 }}
  >
    {expanded ? (
      <path
        d="M7.99977 7.22354L5.17108 10.0522C4.91078 10.3125 4.48875 10.3125 4.22844 10.0522C3.96813 9.79192 3.96812 9.36988 4.22843 9.10957L7.29266 6.04533C7.68318 5.65481 8.31635 5.65481 8.70687 6.04534L11.7711 9.10957C12.0314 9.36988 12.0314 9.79192 11.7711 10.0522C11.5108 10.3125 11.0888 10.3125 10.8285 10.0522L7.99977 7.22354Z"
        transform="rotate(180 8 8)"
        fill="currentColor"
      />
    ) : (
      <path
        d="M8.77597 7.99977L5.9473 5.17108C5.68699 4.91078 5.68699 4.48875 5.94729 4.22844C6.20759 3.96813 6.62963 3.96812 6.88994 4.22843L9.95418 7.29266C10.3447 7.68318 10.3447 8.31635 9.95418 8.70687L6.88994 11.7711C6.62963 12.0314 6.20759 12.0314 5.94729 11.7711C5.68699 11.5108 5.687 11.0888 5.94729 10.8285L8.77597 7.99977Z"
        fill="currentColor"
      />
    )}
  </svg>
);
