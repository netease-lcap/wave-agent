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
      d="M8.51037 1.62988C11.5734 1.78706 14.0767 4.13051 14.4586 7.13184H13.4488C13.0737 4.66903 10.9944 2.75901 8.45568 2.62988L8.45178 2.62891L8.18615 2.62207H8.18225C4.19074 2.62267 1.66373 6.8512 3.44983 10.3086L3.63635 10.6406L3.71154 10.7871C3.85972 11.1269 3.84771 11.5196 3.67053 11.8516L2.97326 13.1572L2.8551 13.3779H7.30334V14.3779H2.02111C1.86809 14.3775 1.72352 14.307 1.62951 14.1885L1.5924 14.1348C1.50265 13.9845 1.4983 13.7973 1.58068 13.6426L2.78772 11.3799L2.80822 11.3271C2.81269 11.3087 2.81456 11.2891 2.81408 11.2695L2.81311 11.25L2.80822 11.2305L2.79748 11.1943L2.79162 11.1758L2.78186 11.1592L2.66662 10.9619C0.334554 6.80657 3.36799 1.62478 8.17932 1.62207L8.51037 1.62988Z"
      fill="currentColor"
    />
    <path
      d="M11.9518 10.8213H14.4781V11.8203H11.9518V14.3779H10.9518V11.8203H8.59826V10.8213H10.9518V8.35938H11.9518V10.8213Z"
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

export const CloseIcon: React.FC<IconProps> = ({
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
      d="M8 8.70711L11.6464 12.3536L12.3536 11.6464L8.70711 8L12.3536 4.35355L11.6464 3.64645L8 7.29289L4.35355 3.64645L3.64645 4.35355L7.29289 8L3.64645 11.6464L4.35355 12.3536L8 8.70711Z"
      fill="currentColor"
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
