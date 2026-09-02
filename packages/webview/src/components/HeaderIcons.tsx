import React from "react";

interface IconProps {
  className?: string;
}

export const NewSessionIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.51529 1.42969H8.52115C11.4794 1.5816 13.931 3.71041 14.5553 6.52246C14.6519 6.95773 14.3037 7.33183 13.8844 7.33203C13.5319 7.33203 13.2487 7.07455 13.1715 6.75098C12.6547 4.58283 10.7459 2.94715 8.44596 2.83008C8.44306 2.82993 8.44006 2.82841 8.43717 2.82812L8.18131 2.82227C4.34246 2.82372 1.91351 6.88823 3.62467 10.2109L3.81119 10.543L3.8151 10.5488L3.88932 10.6953L3.89518 10.707L3.95084 10.8574C4.06092 11.2147 4.02784 11.6069 3.84733 11.9453L3.18912 13.1777H6.80338C7.18997 13.1777 7.50358 13.4913 7.50358 13.8779C7.50358 14.2645 7.18997 14.5781 6.80338 14.5781H2.02115C1.80725 14.5776 1.60512 14.4787 1.4733 14.3125L1.46451 14.3027L1.46549 14.3018L1.42838 14.248L1.42057 14.2373C1.29484 14.0267 1.28981 13.7651 1.40494 13.5488L2.60514 11.2988L2.61295 11.2754L2.60904 11.2598L2.49381 11.0625L2.49283 11.0596C0.0853665 6.76983 3.21661 1.42476 8.17936 1.42188H8.18424L8.51529 1.42969Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M11.4518 8.15918C11.8384 8.15919 12.152 8.47278 12.152 8.85938V10.6211H13.9792C14.3654 10.6212 14.6784 10.9351 14.6784 11.3213C14.6781 11.7073 14.3652 12.0204 13.9792 12.0205H12.152V13.8779C12.152 14.2645 11.8384 14.5781 11.4518 14.5781C11.0653 14.578 10.7516 14.2644 10.7516 13.8779V12.0205H9.0983C8.71213 12.0205 8.39837 11.7074 8.39811 11.3213C8.39811 10.935 8.71197 10.6211 9.0983 10.6211H10.7516V8.85938C10.7516 8.47286 11.0653 8.15931 11.4518 8.15918Z"
      fill="currentColor"
    />
  </svg>
);

export const HistoryIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M8 1.4834C11.5989 1.48357 14.5166 4.40105 14.5166 8C14.5162 11.5985 11.5986 14.5164 8 14.5166C4.45117 14.5166 1.56718 11.679 1.4873 8.14941H2.52051C2.60013 11.1083 5.02189 13.4834 8 13.4834C11.028 13.4832 13.483 11.0279 13.4834 8C13.4834 4.97175 11.0282 2.51678 8 2.5166C6.1153 2.5166 4.45257 3.46743 3.46582 4.91504L3.30566 5.14941H5.18262V6.18262H1.4834V2.4834H2.5166V4.44824L2.78613 4.08887C3.97533 2.50612 5.86841 1.4834 8 1.4834Z"
      fill="currentColor"
    />
    <path
      d="M8.5166 7.78516L10.6152 9.88477L9.88477 10.6152L7.48242 8.21289L7.4834 4.81641H8.5166V7.78516Z"
      fill="currentColor"
    />
  </svg>
);

export const ExternalLinkIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  // Content-tight arrow glyph (10.7071 x 12) from Figma, rotated 45deg to point up-right (↗).
  // Rendered centered in a padded 16x16 box at a modest size (~10.7 x 12 glyph) so it
  // visually matches the other codicons rather than filling the whole box.
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="rotate(45 8 8) translate(2.6465 2)">
      <path
        d="M10.7071 4.99999L5.70711 0H5L0 4.99999L0.707108 5.7071L4.85355 1.56066V12H5.85355V1.56066L9.99998 5.7071L10.7071 4.99999Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

export const InfoIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  // Circle + "i" info glyph in a padded 16x16 box, mirroring the Figma info icon.
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2ZM1 8C1 4.13401 4.13401 1 8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8Z"
      fill="currentColor"
    />
    <path d="M7.375 4.5H8.625V5.75H7.375V4.5Z" fill="currentColor" />
    <path d="M7.375 7H8.625V11.5H7.375V7Z" fill="currentColor" />
  </svg>
);

// 关闭图标 — Figma 12953:61026「功能」组件集 类型=关闭（2026-CodeWave 交互视觉稿）：
// 圆角十字 12×12（臂宽 1.34、圆角 0.67）旋转 45° 成 ×，外接 16.98 ≈ 17。
// 第三十二轮起作为界面统一关闭图标（替换全部 codicon-close 字体图标）。
export const CloseIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 17 17"
    fill="none"
    className={className}
  >
    <path
      d="M8.51 2.5 L9.19 3.17 V7.84 H13.84 L14.51 8.51 H13.84 V9.19 H9.19 V13.83 L8.51 14.5 V13.83 H7.84 V9.19 H3.17 L2.5 8.51 H3.17 V7.84 H7.84 V3.17 Z"
      fill="currentColor"
      transform="rotate(45 8.5 8.5)"
    />
  </svg>
);

export const MoreIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M3.00023 7C3.26536 7.00007 3.51979 7.10549 3.70726 7.29297C3.89472 7.48049 4.00023 7.73484 4.00023 8C4.00023 8.19778 3.94117 8.39121 3.83129 8.55566C3.72148 8.71994 3.56557 8.84814 3.38305 8.92383C3.20032 8.99952 2.9989 9.01905 2.80492 8.98047C2.61101 8.94189 2.43303 8.84681 2.2932 8.70703C2.15338 8.56721 2.05739 8.38924 2.01879 8.19531C1.9802 8.00133 2.00072 7.79991 2.07641 7.61719C2.15209 7.43459 2.28023 7.27878 2.44457 7.16895C2.60902 7.05906 2.80245 7 3.00023 7Z"
      fill="currentColor"
    />
    <path
      d="M8.00023 7C8.26536 7.00007 8.51979 7.10549 8.70726 7.29297C8.89472 7.48049 9.00023 7.73484 9.00023 8C9.00023 8.19778 8.94117 8.39121 8.83129 8.55566C8.72148 8.71994 8.56557 8.84814 8.38305 8.92383C8.20032 8.99952 7.9989 9.01905 7.80492 8.98047C7.61101 8.94189 7.43303 8.84681 7.2932 8.70703C7.15338 8.56721 7.05739 8.38924 7.01879 8.19531C6.9802 8.00133 7.00072 7.79991 7.07641 7.61719C7.15209 7.43459 7.28023 7.27878 7.44457 7.16895C7.60902 7.05906 7.80245 7 8.00023 7Z"
      fill="currentColor"
    />
    <path
      d="M13.0002 7C13.2654 7.00007 13.5198 7.10549 13.7073 7.29297C13.8947 7.48049 14.0002 7.73484 14.0002 8C14.0002 8.19778 13.9412 8.39121 13.8313 8.55566C13.7215 8.71994 13.5656 8.84814 13.383 8.92383C13.2003 8.99952 12.9989 9.01905 12.8049 8.98047C12.611 8.94189 12.433 8.84681 12.2932 8.70703C12.1534 8.56721 12.0574 8.38924 12.0188 8.19531C11.9802 8.00133 12.0007 7.79991 12.0764 7.61719C12.1521 7.43459 12.2802 7.27878 12.4446 7.16895C12.609 7.05906 12.8025 7 13.0002 7Z"
      fill="currentColor"
    />
  </svg>
);

// Composer "+" 添加按钮 — Figma composer-add（20×20 全幅加号，笔画 ~1.7px，
// codechat 同款；此前自绘 13×13 细加号视觉过细）。
export const PlusIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 20 20"
    fill="none"
    className={className}
  >
    <path
      d="M10.0097 2.50153C10.4735 2.50154 10.8493 2.87766 10.8496 3.34137V9.17971H16.6682C17.132 9.17999 17.5081 9.55576 17.5081 10.0196C17.5081 10.4833 17.132 10.8591 16.6682 10.8594H10.8496V16.6582C10.8493 17.122 10.4735 17.4981 10.0097 17.4981C9.54591 17.4981 9.17014 17.122 9.16988 16.6582V10.8594H3.3316C2.86787 10.8591 2.49176 10.4833 2.49176 10.0196C2.49177 9.55576 2.86788 9.17998 3.3316 9.17971H9.16988V3.34137C9.17018 2.87765 9.54594 2.50153 10.0097 2.50153Z"
      fill="currentColor"
    />
  </svg>
);

// Composer "/" 快捷指令按钮 — Figma composer-settings（圆角方块 + 斜线，
// Subtract + Line 325，20×20 viewBox，glyph 16×16 居中），fill #4E5969。
export const SlashBoxIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 20 20"
    fill="none"
    className={className}
  >
    <path
      d="M14.7186 1.93726C16.5826 1.93726 18.0939 3.44854 18.0939 5.3125V14.6875C18.0939 16.5515 16.5826 18.0627 14.7186 18.0627H5.28137C3.41741 18.0627 1.90613 16.5515 1.90613 14.6875V5.3125C1.90613 3.44854 3.41741 1.93726 5.28137 1.93726H14.7186ZM5.28137 3.68774C4.38391 3.68774 3.65662 4.41504 3.65662 5.3125V14.6875C3.65662 15.585 4.38391 16.3123 5.28137 16.3123H14.7186C15.6161 16.3123 16.3434 15.585 16.3434 14.6875V5.3125C16.3434 4.41504 15.6161 3.68774 14.7186 3.68774H5.28137Z"
      fill="currentColor"
    />
    <path
      d="M8.46039 14.4167C8.21873 14.8352 7.68305 14.9786 7.26458 14.737C6.84614 14.4954 6.70269 13.9597 6.9443 13.5412L11.5395 5.58334C11.7812 5.16489 12.3169 5.02144 12.7353 5.26306C13.1536 5.50479 13.2961 6.03986 13.0546 6.45824L8.46039 14.4167Z"
      fill="currentColor"
    />
  </svg>
);

// Composer 发送按钮 — Figma send.svg（stroke 上箭头 1.5、未激活 #ADB0BB）。
// 与 QueueSendIcon（queue 面板实心上箭头）不同：此图标是描边版。
export const SendArrowIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 18 18"
    fill="none"
    className={className}
  >
    <path
      d="M3.75 9L9 3.75L14.25 9"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 14.25V3.75"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// 权限/灰条下拉 chevron — Figma composer-chevron（8×5 细箭头）。
export const PermCaretIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg width={8} height={5} viewBox="0 0 8 5" fill="none" className={className}>
    <path
      d="M3.99977 1.48341L1.1474 4.33577C0.88492 4.59824 0.459358 4.59825 0.196873 4.33577C-0.06562 4.07329 -0.0656245 3.64771 0.196863 3.38523L3.28674 0.295345C3.68053 -0.098449 4.319 -0.0984486 4.71279 0.295346L7.80267 3.38523C8.06515 3.64772 8.06515 4.07329 7.80266 4.33577C7.54017 4.59825 7.11461 4.59824 6.85213 4.33576L3.99977 1.48341Z"
      fill="currentColor"
    />
  </svg>
);

// 灰条「本地」— Figma composer-context-local（终端/运行环境 16×16，fill #565A60）。
export const ContextLocalIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M10.6318 13.1409C10.9908 13.1409 11.2822 13.4323 11.2822 13.7913C11.2821 14.1502 10.9908 14.4417 10.6318 14.4417H5.25C4.89118 14.4415 4.60069 14.1501 4.60059 13.7913C4.60059 13.4324 4.89112 13.141 5.25 13.1409H10.6318Z"
      fill="currentColor"
    />
    <path
      d="M12.1553 0.891846C13.6188 0.891846 14.8056 2.07871 14.8057 3.54224V9.84888C14.8057 11.0363 13.8427 11.9993 12.6553 11.9993H3.84375C2.38039 11.9991 1.19434 10.8123 1.19434 9.34888V3.54224C1.19437 2.0788 2.38034 0.891991 3.84375 0.891846H12.1553ZM3.84375 2.19263C3.09831 2.19277 2.49417 2.79677 2.49414 3.54224V9.34888C2.49414 10.0943 3.09829 10.6983 3.84375 10.6985H12.6553C13.1247 10.6985 13.5049 10.3183 13.5049 9.84888V3.54224C13.5048 2.79668 12.9008 2.19263 12.1553 2.19263H3.84375Z"
      fill="currentColor"
    />
  </svg>
);

// 灰条「工作目录」— Figma composer-context-directory（文件夹 16×16，stroke 1.4）。
export const ContextDirectoryIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M13.333 13.9452C13.6866 13.9452 14.0258 13.8047 14.2758 13.5547C14.5259 13.3046 14.6663 12.9655 14.6663 12.6119L14.6667 5.38802C14.6667 5.0344 14.5262 4.69526 14.2761 4.44521C14.0261 4.19516 13.687 4.05469 13.3333 4.05469H8.06667C7.84368 4.05687 7.6237 4.0031 7.42687 3.89827C7.23004 3.79345 7.06264 3.64094 6.94 3.45469L6.4 2.65469C6.27859 2.47033 6.11332 2.31901 5.919 2.21429C5.72468 2.10956 5.50741 2.05472 5.28667 2.05469H2.66667C2.31304 2.05469 1.97391 2.19516 1.72386 2.44521C1.47381 2.69526 1.33333 3.0344 1.33333 3.38802L1.33301 12.6119C1.33301 12.9655 1.47348 13.3046 1.72353 13.5547C1.97358 13.8047 2.31272 13.9452 2.66634 13.9452H13.333Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 7.05469H14"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Queue header chevron — Figma content-tight right arrow (5.28539 x 9.95205) centered
// in a padded 16x16 box. Points right by default; rotate via CSS for expanded state.
export const QueueChevronIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      transform="translate(5.36 3.02)"
      d="M4.35731 4.97603L0 0.618718L0.618718 0L5.28539 4.66667V5.28538L0.618718 9.95205L0 9.33333L4.35731 4.97603Z"
      fill="currentColor"
    />
  </svg>
);

// Queue item action: edit (pencil) — Figma 11.934 x 11.9471 glyph centered in a 16x16 box.
export const QueueEditIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      transform="translate(2.03 2.03)"
      d="M7.9664 0.439283C8.55216 -0.146457 9.50171 -0.146398 10.0875 0.439283L11.4947 1.84553C12.0803 2.43133 12.0804 3.38189 11.4947 3.9676L4.38633 11.076C4.32169 11.1405 4.23969 11.1861 4.15098 11.2078L1.23789 11.9178C0.511875 12.0948 -0.14489 11.4416 0.0279284 10.7147L0.725194 7.78499C0.746603 7.69518 0.792789 7.61302 0.858007 7.54768L7.9664 0.439283ZM1.66562 8.15413L1.00058 10.9461L3.7789 10.2684L8.45469 5.59163L6.3414 3.47835L1.66562 8.15413ZM9.38047 1.14631C9.1852 0.951157 8.86867 0.951098 8.67344 1.14631L7.04844 2.77131L9.16172 4.8846L10.7877 3.26057C10.9829 3.06538 10.9827 2.74784 10.7877 2.55256L9.38047 1.14631Z"
      fill="currentColor"
    />
  </svg>
);

// Queue item action: send now (up arrow) — Figma 10.7071 x 12 glyph centered in a 16x16 box.
export const QueueSendIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      transform="translate(2.65 2)"
      d="M10.7071 4.99999L5.70711 0H5L0 4.99999L0.707108 5.7071L4.85355 1.56066V12H5.85355V1.56066L9.99998 5.7071L10.7071 4.99999Z"
      fill="currentColor"
    />
  </svg>
);

// Permission mode: default ("修改前询问") — Figma permission-ask（stroke 盾 + 对勾 1.4）。
export const PermModeAskIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M13.3337 8.66664C13.3337 12 11.0003 13.6666 8.22699 14.6333C8.08177 14.6825 7.92402 14.6802 7.78033 14.6266C5.00033 13.6666 2.66699 12 2.66699 8.66664V3.99997C2.66699 3.82316 2.73723 3.65359 2.86225 3.52857C2.98728 3.40355 3.15685 3.33331 3.33366 3.33331C4.66699 3.33331 6.33366 2.53331 7.49366 1.51997C7.6349 1.39931 7.81456 1.33301 8.00033 1.33301C8.18609 1.33301 8.36576 1.39931 8.50699 1.51997C9.67366 2.53997 11.3337 3.33331 12.667 3.33331C12.8438 3.33331 13.0134 3.40355 13.1384 3.52857C13.2634 3.65359 13.3337 3.82316 13.3337 3.99997V8.66664Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6 8.00081L7.33333 9.33415L10 6.66748"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Permission mode: acceptEdits ("自动接受修改") — Figma permission-auto-accept
// （stroke 盾 + 左箭头 + 右横线 1.4）。
export const PermModeAcceptIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M13.3337 8.66664C13.3337 12 11.0003 13.6666 8.22699 14.6333C8.08177 14.6825 7.92402 14.6802 7.78033 14.6266C5.00033 13.6666 2.66699 12 2.66699 8.66664V3.99997C2.66699 3.82316 2.73723 3.65359 2.86225 3.52857C2.98728 3.40355 3.15685 3.33331 3.33366 3.33331C4.66699 3.33331 6.33366 2.53331 7.49366 1.51997C7.6349 1.39931 7.81456 1.33301 8.00033 1.33301C8.18609 1.33301 8.36576 1.39931 8.50699 1.51997C9.67366 2.53997 11.3337 3.33331 12.667 3.33331C12.8438 3.33331 13.0134 3.40355 13.1384 3.52857C13.2634 3.65359 13.3337 3.82316 13.3337 3.99997V8.66664Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.37305 9.3335L6.70638 8.00016L5.37298 6.66683"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.62012 9.3335L10.5057 9.3335"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Permission mode: bypassPermissions ("跳过权限确认") — Figma permission-skip
// （stroke 盾 + 感叹号 1.4，danger 色由 CSS 控制）。
export const PermModeBypassIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M13.3337 8.66664C13.3337 12 11.0003 13.6666 8.22699 14.6333C8.08177 14.6825 7.92402 14.6802 7.78033 14.6266C5.00033 13.6666 2.66699 12 2.66699 8.66664V3.99997C2.66699 3.82316 2.73723 3.65359 2.86225 3.52857C2.98728 3.40355 3.15685 3.33331 3.33366 3.33331C4.66699 3.33331 6.33366 2.53331 7.49366 1.51997C7.6349 1.39931 7.81456 1.33301 8.00033 1.33301C8.18609 1.33301 8.36576 1.39931 8.50699 1.51997C9.67366 2.53997 11.3337 3.33331 12.667 3.33331C12.8438 3.33331 13.0134 3.40355 13.1384 3.52857C13.2634 3.65359 13.3337 3.82316 13.3337 3.99997V8.66664Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 5.43555V7.91448"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 10.3403L7.99954 10.3936"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Permission mode: plan ("计划模式") — Figma permission-plan（stroke 清单/时间表 1.4）。
export const PermModePlanIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M6.19434 7.59692L9.80565 7.59692"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6.19434 10.8096L9.80565 10.8096"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.39648 2.24825C5.39648 1.80642 5.75466 1.44825 6.19648 1.44825L9.80332 1.44824C10.2451 1.44824 10.6033 1.80642 10.6033 2.24824V3.2373C10.6033 3.67913 10.2452 4.0373 9.80332 4.0373H6.19649C5.75466 4.0373 5.39648 3.67913 5.39648 3.2373L5.39648 2.24825Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M11.0958 2.74271H11.7891C12.8495 2.74271 13.7091 3.60233 13.7091 4.66271V8.64719V12.6317C13.7091 13.6921 12.8495 14.5517 11.7891 14.5517L4.21101 14.5516C3.15063 14.5516 2.29102 13.692 2.29102 12.6316L2.29102 4.6627C2.29102 3.60231 3.15063 2.7427 4.21101 2.7427L5.3301 2.74269"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

// Queue item action: delete (trash) — Figma 12.4329 x 13 glyph centered in a 16x16 box.
export const QueueTrashIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="translate(1.78 1.5)">
      <path
        d="M5.14941 4.12191V10.2623H4.13673V4.12191H5.14941Z"
        fill="currentColor"
      />
      <path
        d="M8.29618 4.12191V10.2623H7.28348V4.12191H8.29618Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.01771 0C7.88318 1.28547e-06 8.59523 0.657804 8.68051 1.50076L8.68742 1.56893H11.6317V1.57289H12.4329V2.58557H11.6317V10.7464C11.6317 11.9909 10.6226 12.9999 9.37803 13H3.05487C1.81034 12.9999 0.801262 11.9909 0.801262 10.7464V2.58557H0V1.57289H0.801262V1.56893H3.74548L3.75239 1.50076C3.83767 0.657798 4.54971 0 5.41519 0H7.01771ZM1.81396 2.58557V10.7464C1.81396 11.4316 2.3698 11.9872 3.05487 11.9873H9.37803C10.0631 11.9872 10.6179 11.4316 10.6179 10.7464V2.58557H1.81396ZM5.41519 1.0127C5.1216 1.0127 4.87272 1.20493 4.78781 1.47013L4.7562 1.56893H7.6767L7.64509 1.47013C7.56018 1.20494 7.31129 1.0127 7.01771 1.0127H5.41519Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

// 会话行更多菜单「并排打开」— codechat TaskSidebar 同款 lucide columns-2
// （18×18 rx2 外框 + 中竖线，stroke 2 / currentColor）。
export const SplitIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={15}
    height={15}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </svg>
);

// Header 面板切换 — Figma preview-toggle（40×24：左侧「右侧面板布局」+ 右侧
// chevron-down，codechat WorkspaceHeader 同款，fill #4E5969 → currentColor）。
export const PanelToggleIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={40}
    height={24}
    viewBox="0 0 40 24"
    fill="none"
    className={className}
  >
    <path
      d="M11.376 9.49512C11.1027 9.22186 10.6591 9.22198 10.3857 9.49512L8.37598 11.5049L8.28906 11.6113C8.21281 11.7256 8.1709 11.8606 8.1709 12C8.17094 12.1856 8.24474 12.3639 8.37598 12.4951L10.3857 14.5049C10.6591 14.778 11.1027 14.7781 11.376 14.5049C11.649 14.2316 11.649 13.788 11.376 13.5146L9.86133 12L11.376 10.4854C11.6491 10.2121 11.649 9.76845 11.376 9.49512Z"
      fill="currentColor"
    />
    <path
      d="M7.25 5.5498C5.75883 5.5498 4.5498 6.75883 4.5498 8.25V15.75C4.5498 17.2412 5.75883 18.4502 7.25 18.4502H16.75C18.2412 18.4502 19.4502 17.2412 19.4502 15.75V8.25C19.4502 6.75883 18.2412 5.5498 16.75 5.5498H7.25ZM16.75 6.9502C17.468 6.9502 18.0498 7.53203 18.0498 8.25V15.75C18.0498 16.468 17.468 17.0498 16.75 17.0498H15.6348V6.9502H16.75ZM14.2344 17.0498H7.25C6.53203 17.0498 5.9502 16.468 5.9502 15.75V8.25C5.9502 7.53203 6.53203 6.9502 7.25 6.9502H14.2344V17.0498Z"
      fill="currentColor"
    />
    <path
      d="M29.7687 12.7764L32.5974 9.94773C32.8577 9.68743 33.2797 9.68742 33.54 9.94772C33.8003 10.208 33.8003 10.6301 33.54 10.8904L30.4758 13.9546C30.0853 14.3451 29.4521 14.3451 29.0616 13.9546L25.9973 10.8904C25.737 10.6301 25.737 10.208 25.9973 9.94772C26.2577 9.68742 26.6797 9.68743 26.94 9.94773L29.7687 12.7764Z"
      fill="currentColor"
    />
  </svg>
);

// Pane 关闭（关闭分屏）— Figma conversation-close（16×16 细 ×，fill #4E5969）。
export const ConversationCloseIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M12.2474 3.76372C12.5097 4.02608 12.5095 4.45142 12.2474 4.7139L8.94473 8.01656L12.2363 11.3081C12.4984 11.5706 12.4986 11.9959 12.2363 12.2583C11.9739 12.5206 11.5486 12.5204 11.2861 12.2583L7.99456 8.96674L4.71423 12.2471C4.45175 12.5092 4.02643 12.5094 3.76406 12.2471C3.50169 11.9847 3.50187 11.5594 3.76406 11.2969L7.04438 8.01656L3.74175 4.71393C3.47958 4.45145 3.47939 4.02612 3.74175 3.76376C4.00412 3.50141 4.42945 3.50159 4.69193 3.76376L7.99456 7.06639L11.2972 3.76372C11.5597 3.50158 11.985 3.50137 12.2474 3.76372Z"
      fill="currentColor"
    />
  </svg>
);

/** 侧边栏展开/收起入口图标（对齐原型 figma 收起任务列表图标：外框 + 左侧窄条）。 */
export const CollapseIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="currentColor"
    className={className}
  >
    <path d="M12.75 1.5498C14.2412 1.5498 15.4502 2.75883 15.4502 4.25V11.75C15.4502 13.2412 14.2412 14.4502 12.75 14.4502H3.25C1.75883 14.4502 0.549805 13.2412 0.549805 11.75V4.25C0.549805 2.75883 1.75883 1.5498 3.25 1.5498H12.75ZM5.76562 13.0498H12.75C13.468 13.0498 14.0498 12.468 14.0498 11.75V4.25C14.0498 3.53203 13.468 2.9502 12.75 2.9502H5.76562V13.0498ZM3.25 2.9502C2.53203 2.9502 1.9502 3.53203 1.9502 4.25V11.75C1.9502 12.468 2.53203 13.0498 3.25 13.0498H4.36523V2.9502H3.25Z" />
  </svg>
);

/** 侧边栏收起后 header 的展开按钮图标（对齐原型 sidebar-expand.svg：
 *  外框 + 朝右箭头 →，表示点击向左侧展开）。与 CollapseIcon（外框+左条）
 *  不同 —— 收起按钮在侧栏内朝左、展开按钮在 header 朝右。 */
export const SidebarExpandIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="currentColor"
    className={className}
  >
    <path d="M8.62402 5.49512C8.89732 5.22186 9.34088 5.22198 9.61426 5.49512L11.624 7.50488L11.7109 7.61133C11.7872 7.72555 11.8291 7.86064 11.8291 8C11.8291 8.18559 11.7553 8.36388 11.624 8.49512L9.61426 10.5049C9.34088 10.778 8.8973 10.7781 8.62402 10.5049C8.35096 10.2316 8.35101 9.78797 8.62402 9.51465L10.1387 8L8.62402 6.48535C8.35095 6.21207 8.35102 5.76845 8.62402 5.49512Z" />
    <path d="M12.75 1.5498C14.2412 1.5498 15.4502 2.75883 15.4502 4.25V11.75C15.4502 13.2412 14.2412 14.4502 12.75 14.4502H3.25C1.75883 14.4502 0.549805 13.2412 0.549805 11.75V4.25C0.549805 2.75883 1.75883 1.5498 3.25 1.5498H12.75ZM5.76562 13.0498H12.75C13.468 13.0498 14.0498 12.468 14.0498 11.75V4.25C14.0498 3.53203 13.468 2.9502 12.75 2.9502H5.76562V13.0498ZM3.25 2.9502C2.53203 2.9502 1.9502 3.53203 1.9502 4.25V11.75C1.9502 12.468 2.53203 13.0498 3.25 13.0498H4.36523V2.9502H3.25Z" />
  </svg>
);

// ── PreviewPane 工具栏图标（对齐原型 InspectorPanel.vue —— codechat-ui
//    src/assets/figma 直接 Figma 导出，fill 改为 currentColor 以适配浅/深主题）──

/** 元素拾取（inspector-cursor.svg）：光标 + 圆角框。 */
export const InspectorCursorIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="translate(-4 -4)">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.4873 10.5291C10.7147 10.0414 11.2362 9.7651 11.7607 9.84253L11.8652 9.86206L11.8701 9.86401L11.9785 9.89526L11.9834 9.89722L18.2549 12.0828C18.5054 12.1702 18.7182 12.3365 18.8633 12.5535L18.9219 12.6492L18.9238 12.6531L18.9746 12.7605L18.9795 12.7703L19.0176 12.8777L19.0186 12.8826C19.1935 13.4712 18.8981 14.1081 18.3184 14.3474L15.8896 15.3464L14.8906 17.7751C14.7587 18.0952 14.4961 18.3438 14.1689 18.4578C13.5371 18.6777 12.8457 18.3447 12.625 17.7126L10.4404 11.4402C10.3507 11.1823 10.3507 10.9013 10.4404 10.6433L10.4414 10.6384L10.4854 10.533L10.4873 10.5291ZM13.7891 16.614L14.6562 14.5105L14.7715 14.2292L14.8105 14.2136L15.0537 14.114L17.1572 13.2458L11.9863 11.4431L13.7891 16.614Z"
        fill="currentColor"
      />
    </g>
    <g transform="translate(-4 -4)">
      <path
        d="M15.7666 5.47437C17.2575 5.47463 18.4667 6.68367 18.4668 8.17456V9.67456C18.4667 10.0609 18.1529 10.3745 17.7666 10.3748C17.3801 10.3748 17.0665 10.061 17.0664 9.67456V8.17456C17.0663 7.45687 16.4843 6.87502 15.7666 6.87476H7.63281C6.91492 6.87476 6.33314 7.4567 6.33301 8.17456V15.1746C6.33327 15.8923 6.91501 16.4744 7.63281 16.4744H9.7002C10.0863 16.4749 10.3993 16.7884 10.3994 17.1746C10.3992 17.5606 10.0862 17.8733 9.7002 17.8738H7.63281C6.14181 17.8738 4.9319 16.6655 4.93164 15.1746V8.17456C4.93177 6.6835 6.14173 5.47437 7.63281 5.47437H15.7666Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

/** 刷新（refresh.svg）：循环箭头。 */
export const RefreshIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="translate(-4 -4)">
      <path
        d="M5.64429 10.3562C6.55403 7.17515 9.86218 5.33285 13.0421 6.24223C15.7644 7.0208 17.4986 9.56482 17.3709 12.2758L17.4935 12.1704L18.1037 11.5602C18.3738 11.2905 18.8116 11.2904 19.0817 11.5602C19.3519 11.8305 19.3519 12.2691 19.0817 12.5393L17.2908 14.3302C17.0207 14.5999 16.5828 14.6 16.3128 14.3302L14.5218 12.5393C13.8911 11.9084 14.87 10.9295 15.5009 11.5602L16.0736 12.1339C16.1364 10.0444 14.7925 8.09931 12.6904 7.498C10.2034 6.78675 7.60982 8.2261 6.89803 10.715C6.18749 13.1999 7.62637 15.7938 10.114 16.5053C11 16.7587 11.8992 16.7356 12.7218 16.4921C13.0996 16.3803 13.5334 16.5345 13.6867 16.8975C13.8174 17.2071 13.6618 17.552 13.3441 17.6617C12.224 18.0486 10.9803 18.1094 9.75519 17.759C6.57545 16.8495 4.73544 13.5341 5.64429 10.3562Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

/** 在浏览器中打开（open-browser.svg）：浏览器框 + 右上箭头。 */
export const OpenBrowserIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="translate(-4 -4)">
      <path
        d="M11.6016 6.41647C11.988 6.4166 12.3016 6.73026 12.3018 7.11667C12.3018 7.50318 11.988 7.81673 11.6016 7.81686H8.10156C7.38367 7.81686 6.80189 8.39881 6.80176 9.11667V16.1167C6.80176 16.8346 7.38359 17.4165 8.10156 17.4165H15.1016C15.8193 17.4162 16.4014 16.8345 16.4014 16.1167V12.4301C16.4015 12.0437 16.715 11.7299 17.1016 11.7299C17.4879 11.7302 17.8006 12.0438 17.8008 12.4301V16.1167C17.8008 17.6077 16.5925 18.8166 15.1016 18.8169H8.10156C6.61039 18.8169 5.40137 17.6078 5.40137 16.1167V9.11667C5.4015 7.62561 6.61048 6.41647 8.10156 6.41647H11.6016Z"
        fill="currentColor"
      />
    </g>
    <g transform="translate(-4 -4)">
      <path
        d="M17.9309 5.18311C18.299 5.1831 18.5978 5.48104 18.5979 5.84912V9.44873C18.5979 9.81691 18.2991 10.1157 17.9309 10.1157C17.5627 10.1157 17.2639 9.81692 17.2639 9.44873V7.4585L11.865 12.8594C11.6046 13.1197 11.182 13.1197 10.9216 12.8594C10.6613 12.599 10.6613 12.1764 10.9216 11.916L16.3215 6.51611H14.3313C13.9631 6.51612 13.6643 6.21731 13.6643 5.84912C13.6644 5.48105 13.9632 5.18311 14.3313 5.18311H17.9309Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

/** 全屏（maximize.svg）：窗口四角箭头。 */
export const MaximizeIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="translate(-4 -4)">
      <path
        d="M11.1381 12.8619C11.3984 13.1223 11.3984 13.5444 11.1381 13.8047L8.27614 16.6667H10.0953C10.4635 16.6667 10.7619 16.9652 10.7619 17.3334C10.7619 17.7016 10.4635 18 10.0953 18H6.66667C6.29848 18 6 17.7016 6 17.3334V13.9048C6 13.5366 6.29848 13.2381 6.66667 13.2381C7.03486 13.2381 7.33333 13.5366 7.33333 13.9048V15.7239L10.1953 12.8619C10.4556 12.6016 10.8777 12.6016 11.1381 12.8619Z"
        fill="currentColor"
      />
    </g>
    <g transform="translate(-4 -4)">
      <path
        d="M13.3333 6.66667C13.3333 6.29848 13.6318 6 14 6H17.3333C17.7015 6 18 6.29848 18 6.66667V10C18 10.3682 17.7015 10.6667 17.3333 10.6667C16.9651 10.6667 16.6666 10.3682 16.6666 10V8.27615L13.8047 11.1381C13.5444 11.3984 13.1223 11.3984 12.8619 11.1381C12.6016 10.8777 12.6016 10.4556 12.8619 10.1953L15.7238 7.33333H14C13.6318 7.33333 13.3333 7.03486 13.3333 6.66667Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

/** 退出全屏（inspector-unmaximize.svg）：窗口四角还原箭头。 */
export const UnmaximizeIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <g transform="translate(-4 -4)">
      <path
        d="M10.666 12.6669C11.0341 12.6669 11.3329 12.9657 11.3329 13.3339V16.6669C11.3329 17.035 11.0341 17.3339 10.666 17.3339C10.298 17.3336 10 17.0348 9.99994 16.6669V14.9432L7.13763 17.8046C6.87728 18.0649 6.4556 18.0649 6.19525 17.8046C5.93492 17.5442 5.93491 17.1225 6.19525 16.8622L9.05658 13.9999H7.33294C6.96498 13.9998 6.6662 13.7018 6.66595 13.3339C6.66595 12.9657 6.96482 12.667 7.33294 12.6669H10.666Z"
        fill="currentColor"
      />
    </g>
    <g transform="translate(-4 -4)">
      <path
        d="M16.8622 6.19519C17.1226 5.93498 17.5443 5.93489 17.8046 6.19519C18.0648 6.4555 18.0648 6.87725 17.8046 7.13757L14.9423 9.99988H16.7617C17.1298 9.99988 17.4286 10.2987 17.4286 10.6669C17.4284 11.0349 17.1297 11.3329 16.7617 11.3329H13.3329C12.965 11.3328 12.6672 11.0348 12.6669 10.6669V7.23816C12.6669 6.87004 12.9649 6.57128 13.3329 6.57117C13.7011 6.57117 13.9999 6.86997 13.9999 7.23816V9.05652L16.8622 6.19519Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

// ═══ 设置界面图标（第三十八轮，Figma 13383:4078 图标规范 + codechat-ui
//   settings-*.svg 直接导出）════
// 全部 16×16、stroke/fill currentColor（color 由 CSS 控制：light #565A60 /
// dark #9A9EA5，规范 normal/hover 同色，hover 只变底 #EEF0F3）。

/** 设置-全局设置（settings-global.svg）：滑块/调节 */
export const SettingsGlobalIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M9.33333 11.3333H3.33333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.6667 4.66667H6.66667"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.3333 13.3333C12.4379 13.3333 13.3333 12.4379 13.3333 11.3333C13.3333 10.2288 12.4379 9.33333 11.3333 9.33333C10.2288 9.33333 9.33333 10.2288 9.33333 11.3333C9.33333 12.4379 10.2288 13.3333 11.3333 13.3333Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4.66667 6.66667C5.77124 6.66667 6.66667 5.77124 6.66667 4.66667C6.66667 3.5621 5.77124 2.66667 4.66667 2.66667C3.5621 2.66667 2.66667 3.5621 2.66667 4.66667C2.66667 5.77124 3.5621 6.66667 4.66667 6.66667Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-个性化（settings-personalization.svg）：齿轮 + 加号 */
export const SettingsPersonalizationIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M7.34467 1.876C7.37323 1.72307 7.45438 1.58494 7.57406 1.48555C7.69375 1.38615 7.84442 1.33174 8 1.33174C8.15558 1.33174 8.30625 1.38615 8.42594 1.48555C8.54562 1.58494 8.62677 1.72307 8.65533 1.876L9.356 5.58133C9.40576 5.84477 9.53378 6.08708 9.72335 6.27665C9.91292 6.46622 10.1552 6.59424 10.4187 6.644L14.124 7.34467C14.2769 7.37323 14.4151 7.45438 14.5145 7.57406C14.6139 7.69375 14.6683 7.84442 14.6683 8C14.6683 8.15558 14.6139 8.30625 14.5145 8.42594C14.4151 8.54562 14.2769 8.62677 14.124 8.65533L10.4187 9.356C10.1552 9.40576 9.91292 9.53378 9.72335 9.72335C9.53378 9.91292 9.40576 10.1552 9.356 10.4187L8.65533 14.124C8.62677 14.2769 8.54562 14.4151 8.42594 14.5145C8.30625 14.6139 8.15558 14.6683 8 14.6683C7.84442 14.6683 7.69375 14.6139 7.57406 14.5145C7.45438 14.4151 7.37323 14.2769 7.34467 14.124L6.644 10.4187C6.59424 10.1552 6.46622 9.91292 6.27665 9.72335C6.08708 9.53378 5.84477 9.40576 5.58133 9.356L1.876 8.65533C1.72307 8.62677 1.58494 8.54562 1.48555 8.42594C1.38615 8.30625 1.33174 8.15558 1.33174 8C1.33174 7.84442 1.38615 7.69375 1.48555 7.57406C1.58494 7.45438 1.72307 7.37323 1.876 7.34467L5.58133 6.644C5.84477 6.59424 6.08708 6.46622 6.27665 6.27665C6.46622 6.08708 6.59424 5.84477 6.644 5.58133L7.34467 1.876Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.3333 1.33333V4"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14.6667 2.66667H12"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.66667 14.6667C3.40305 14.6667 4 14.0697 4 13.3333C4 12.597 3.40305 12 2.66667 12C1.93029 12 1.33333 12.597 1.33333 13.3333C1.33333 14.0697 1.93029 14.6667 2.66667 14.6667Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-项目设置（settings-project.svg）：文件夹 + 齿轮角 */
export const SettingsProjectIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M6.86667 13.3333H2.66667C2.31304 13.3333 1.97391 13.1929 1.72386 12.9428C1.47381 12.6928 1.33333 12.3536 1.33333 12V3.33333C1.33333 2.97971 1.47381 2.64057 1.72386 2.39052C1.97391 2.14048 2.31304 2 2.66667 2H5.32C5.54299 1.99781 5.76297 2.05159 5.9598 2.15641C6.15663 2.26123 6.32403 2.41375 6.44667 2.6L6.88667 3.4C7.00807 3.58435 7.17335 3.73568 7.36767 3.8404C7.56198 3.94512 7.77926 3.99996 8 4H13.3333C13.687 4 14.0261 4.14048 14.2761 4.39052C14.5262 4.64057 14.6667 4.97971 14.6667 5.33333V7.53333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.53667 13.02L10.152 12.7653"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.152 11.2347L9.53667 10.9793"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.2347 10.152L10.9793 9.53667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.2347 13.848L10.9793 14.464"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.7653 10.152L13.0207 9.53667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.02 14.464L12.7653 13.848"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.848 11.2347L14.464 10.9793"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.848 12.7653L14.464 13.0207"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 14C13.1046 14 14 13.1046 14 12C14 10.8954 13.1046 10 12 10C10.8954 10 10 10.8954 10 12C10 13.1046 10.8954 14 12 14Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-技能（settings-skills.svg）：网格 */
export const SettingsSkillsIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M6.66667 5.33333H6.67333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8 8H8.00667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.33333 5.33333H9.34"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.6667 8H10.6733"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 5.33333H12.0067"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 5.33333H4.00667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4.66667 10.6667H11.3333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.33333 8H5.34"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.3333 2.66667H2.66667C1.93029 2.66667 1.33333 3.26362 1.33333 4V12C1.33333 12.7364 1.93029 13.3333 2.66667 13.3333H13.3333C14.0697 13.3333 14.6667 12.7364 14.6667 12V4C14.6667 3.26362 14.0697 2.66667 13.3333 2.66667Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-子代理（settings-subagents.svg）：文档 + 分支 */
export const SettingsSubagentsIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M8 5.33333V2.66667H5.33333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 5.33333H4C3.26362 5.33333 2.66667 5.93029 2.66667 6.66667V12C2.66667 12.7364 3.26362 13.3333 4 13.3333H12C12.7364 13.3333 13.3333 12.7364 13.3333 12V6.66667C13.3333 5.93029 12.7364 5.33333 12 5.33333Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M1.33333 9.33333H2.66667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.3333 9.33333H14.6667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 8.66667V10"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6 8.66667V10"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-钩子（settings-hooks.svg）：钩子 */
export const SettingsHooksIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M10 4C8.4087 4 6.88258 4.63214 5.75736 5.75736C4.63214 6.88258 4 8.4087 4 10V2"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 6C13.1046 6 14 5.10457 14 4C14 2.89543 13.1046 2 12 2C10.8954 2 10 2.89543 10 4C10 5.10457 10.8954 6 12 6Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 14C5.10457 14 6 13.1046 6 12C6 10.8954 5.10457 10 4 10C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-MCP 服务（settings-mcp.svg）：地球 + 链接 */
export const SettingsMcpIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      d="M4.2 13.5333C4.34865 13.6825 4.52527 13.8008 4.71976 13.8816C4.91424 13.9624 5.12275 14.0039 5.33333 14.0039C5.54392 14.0039 5.75243 13.9624 5.94691 13.8816C6.14139 13.8008 6.31802 13.6825 6.46667 13.5333L8 12L4 8L2.46667 9.53333C2.3175 9.68198 2.19915 9.85861 2.1184 10.0531C2.03764 10.2476 1.99607 10.4561 1.99607 10.6667C1.99607 10.8772 2.03764 11.0858 2.1184 11.2802C2.19915 11.4747 2.3175 11.6514 2.46667 11.8L4.2 13.5333Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M1.33333 14.6667L3.33333 12.6667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 9L6.66667 7.33333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7 11L8.66667 9.33333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 2L9.33333 4.66667H13.3333L10.6667 7.33333"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 设置-返回（settings-back.svg）：左箭头 */
export const SettingsBackIcon: React.FC<IconProps> = ({
  className = "header-icon",
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.69977 12.4311C7.43942 12.6914 7.01731 12.6914 6.75696 12.4311L2.7974 8.47151C2.53705 8.21116 2.53705 7.78905 2.7974 7.5287L6.75696 3.56914C7.01731 3.30879 7.43942 3.30879 7.69977 3.56914C7.96012 3.82949 7.96012 4.2516 7.69977 4.51195L4.87828 7.33344L12.7308 7.33292C13.099 7.33292 13.3975 7.6314 13.3975 7.99959C13.3975 8.36778 13.099 8.66625 12.7308 8.66625L4.87828 8.66677L7.69977 11.4883C7.96012 11.7486 7.96012 12.1707 7.69977 12.4311Z"
      fill="currentColor"
    />
  </svg>
);
