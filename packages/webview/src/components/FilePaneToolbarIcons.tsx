import React from "react";

/**
 * 文件面板工具条四颗图标（官方矢量，1029 第十三轮）。
 *
 * 来源：设计师 2026-10-29 预览评论 —— `div.preview-pane-toolbar`
 * 「返回文件列表 本地 lib/index.ts 隐藏文件树 在文件树中显示…」+「替换4个图标，
 * 图标路径 /Users/ailsa/Desktop/icon」。四份 SVG 一一对应工具条上的四个入口：
 *   显示隐藏文件树.svg → TreeToggleIcon（原 codicon-files）
 *   在文件树中显示.svg → RevealInTreeIcon（原 codicon-list-selection）
 *   评论.svg           → CommentIcon（原 codicon-comment）
 *   复制.svg           → CopyPathIcon（原 codicon-copy）
 *
 * 与源文件的唯一差异：源文件把 `stroke="#565A60"` 写死在每条 path 上，这里改成
 * `currentColor` —— 桌面端按钮已是 #565A60（浅）/ #9A9EA5（深）、hover 到
 * 主文字色、`.active` 到 #1F2329 / #FFF，写死颜色会让这三态全部失效（原先的
 * codicon 就吃亏在这里：`.codicon` 自带 #606060 / #CCCCCC，比同排 SVG 图标浅）。
 * 尺寸、viewBox、线宽 1.4、圆头圆角一律照源文件。
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

interface IconProps {
  className?: string;
}

const Box: React.FC<IconProps & { children: React.ReactNode }> = ({
  className = "preview-pane-icon",
  children,
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** 显示 / 隐藏文件树：两层文件夹叠影。 */
export const TreeToggleIcon: React.FC<IconProps> = ({ className }) => (
  <Box className={className}>
    <path
      d="M6.96625 14.1483H2.98926C1.88469 14.1483 0.989258 13.2529 0.989258 12.1483V9.0174V5.88647C0.989258 4.78191 1.88469 3.88647 2.98926 3.88647H4.28707C4.76505 3.88647 5.21442 4.11428 5.49696 4.49982L5.87979 5.02221C6.16233 5.40775 6.6117 5.63555 7.08968 5.63555H10.525C11.6407 5.63555 12.5398 6.54846 12.53 7.66414C12.5158 9.26271 12.5165 10.5456 12.5179 12.148C12.5189 13.2526 11.6237 14.1483 10.5191 14.1483H6.96625Z"
      {...STROKE}
    />
    <path
      d="M14.6826 10.9871L14.7725 10.8313C14.9044 10.6029 14.9737 10.3438 14.9735 10.08C14.9726 8.6036 14.9738 6.90681 14.9877 5.15884C14.9965 4.04316 14.0969 3.13018 12.9811 3.13018H9.34608C8.8681 3.13018 8.41873 2.90238 8.13619 2.51684L7.75335 1.99444C7.47081 1.60891 7.02145 1.3811 6.54346 1.3811H5.8515C5.48026 1.3811 5.12215 1.51882 4.84653 1.76753L4.81738 1.79384"
      {...STROKE}
    />
  </Box>
);

/** 在文件树中显示：文件夹 + 放大镜（树的终点就是那个文件）。 */
export const RevealInTreeIcon: React.FC<IconProps> = ({ className }) => (
  <Box className={className}>
    <path
      d="M7.5206 13.9453H3.33301C2.22844 13.9453 1.33301 13.0499 1.33301 11.9453V8V4.05469C1.33301 2.95012 2.22844 2.05469 3.33301 2.05469H5.27495C5.75293 2.05469 6.2023 2.28249 6.48484 2.66803L7.07112 3.46804C7.35366 3.85358 7.80303 4.08139 8.28101 4.08139H12.7043C13.82 4.08139 14.7182 4.99453 14.7045 6.11017C14.6968 6.74064 14.6932 7.25803 14.6916 8.07751"
      {...STROKE}
    />
    <circle cx={10.9315} cy={10.629} r={2.17029} {...STROKE} />
    <path d="M12.5176 12.4097L14.0531 13.9453" {...STROKE} />
  </Box>
);

/** 评论：圆角对话气泡（直角那侧压在左下，指向被评论的代码行）。 */
export const CommentIcon: React.FC<IconProps> = ({ className }) => (
  <Box className={className}>
    <path
      d="M1.7998 14.2H4.59075H7.99984C11.424 14.2 14.1998 11.4242 14.1998 8.00008C14.1998 4.57596 11.424 1.80015 7.9999 1.80012C4.57574 1.80008 1.79988 4.57587 1.79984 8.00003L1.7998 11.0341V14.2Z"
      {...STROKE}
    />
  </Box>
);

/** 复制路径：两张叠放的纸。 */
export const CopyPathIcon: React.FC<IconProps> = ({ className }) => (
  <Box className={className}>
    <path
      d="M6.45235 14.207H3.80078C2.69621 14.207 1.80078 13.3116 1.80078 12.207V9.70703V7.20703C1.80078 6.10246 2.69621 5.20703 3.80078 5.20703H8.77533C9.88979 5.20703 10.789 6.11795 10.7819 7.23239C10.7714 8.89058 10.7718 10.5488 10.7729 12.207C10.7736 13.3116 9.8784 14.207 8.77383 14.207H6.45235Z"
      {...STROKE}
    />
    <path
      d="M5.19922 4.85585V3.99297C5.19922 2.77794 6.18419 1.79297 7.39922 1.79297H11.9712C13.1971 1.79297 14.1862 2.79499 14.1791 4.02087C14.1703 5.54488 14.1703 7.06891 14.1712 8.59297C14.1719 9.80799 13.1873 10.793 11.9723 10.793H11.0462"
      {...STROKE}
    />
  </Box>
);
