import React, { useId } from "react";

export interface CommentChipIconProps {
  className?: string;
  /**
   * 悬停态 = 源文件 `评论hover.svg`（实心蓝气泡，**不带**那条内描边环）。
   * 两态各是一份独立导出，所以这里按 variant 出两套 path，由 CSS 的
   * `:hover` 负责切换（不做 JS 状态，hover 不参与组件重渲染）。
   */
  hover?: boolean;
}

/**
 * 代码选区旁的「评论」气泡按钮图标（1029 第十二批）。
 *
 * 来源：设计师 2026-10-29 预览评论 —— `button.code-comment-chip`
 * 「这个图标的样式我放在桌面的icon文件夹里面了修改一下」，
 * 两份 SVG：`~/Desktop/icon/评论normal.svg`、`~/Desktop/icon/评论hover.svg`
 * （24×24 画板、气泡墨迹 5.1→18.9、`dy=1 / stdDeviation=0.9 / 黑 40%` 投影）。
 *
 * 与源文件的差异：
 *  1. 常态（normal）两档主题同一份图 —— 1029 评论第十三批「深色模式和浅色模式
 *     normal 状态可以用相同的图标」：气泡面 `#FFFFFF`、内描边环 `#000000` 写死。
 *  2. 悬停态（hover）跟随主题：1029 评论第十五批「深色的 hover 应该是以下颜色」
 *     （指着消息里的 `span.write-tool-path`）⇒ 悬停面不再写死 `#2F5EDB`，改成
 *     `currentColor`，由 LineCommentBox.css 按主题取 `--cc-text-link`
 *     （浅 #2F5EDB / 深 #4DAAFC，与消息内链接、`.write-tool-path` 同一档）。
 * 唯一的工程改动：投影照搬源文件的 `<filter>`，只把 id 换成 `useId()` 派生的
 * 唯一值 —— 同一页面里 normal / hover 两份图标共存，写死 id 会互相抢。
 * 尺寸不在这里定：由 LineCommentBox.css 的桌面端规则给（当前 40×40，画板等比）。
 */
export const CommentChipIcon: React.FC<CommentChipIconProps> = ({
  className,
  hover,
}) => {
  const uid = useId().replace(/[:]/g, "");
  const filterId = `code-comment-chip-shadow-${uid}`;
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g filter={`url(#${filterId})`}>
        <path
          d="M12.0005 5.1001C15.8111 5.10019 18.8998 8.18991 18.8999 12.0005C18.8998 15.8111 15.8111 18.8998 12.0005 18.8999H5.80029C5.41382 18.8999 5.10031 18.5871 5.1001 18.2007V12.0005C5.10027 8.18984 8.18982 5.10006 12.0005 5.1001Z"
          fill={hover ? "currentColor" : "#ffffff"}
        />
      </g>
      {!hover && (
        <path
          d="M17.0044 12.0007C17.0044 9.23734 14.7639 6.99692 12.0005 6.99683C9.23702 6.9968 6.99661 9.23727 6.99658 12.0007V17.0046H12.0005C14.7638 17.0045 17.0043 14.7641 17.0044 12.0007ZM18.0044 12.0007C18.0043 15.3163 15.3161 18.0045 12.0005 18.0046H6.49658C6.22057 18.0046 5.99679 17.7806 5.99658 17.5046V12.0007C5.99662 8.68498 8.68474 5.99679 12.0005 5.99683C15.3162 5.99692 18.0044 8.68505 18.0044 12.0007Z"
          fill="#000000"
        />
      )}
      <defs>
        <filter
          id={filterId}
          x="3.3001"
          y="4.3001"
          width="17.3998"
          height="17.3998"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="0.9" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.4 0"
          />
          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
            result="effect1_dropShadow"
          />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="effect1_dropShadow"
            result="shape"
          />
        </filter>
      </defs>
    </svg>
  );
};

export default CommentChipIcon;
