import React from 'react';

interface IconProps {
  className?: string;
}

export const NewSessionIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
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

export const HistoryIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
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

export const ExternalLinkIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  // Content-tight arrow glyph (10.7071 x 12) from Figma, rotated 45deg to point up-right (↗).
  // Rendered centered in a padded 16x16 box at a modest size (~10.7 x 12 glyph) so it
  // visually matches the other codicons rather than filling the whole box.
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <g transform="rotate(45 8 8) translate(2.6465 2)">
      <path
        d="M10.7071 4.99999L5.70711 0H5L0 4.99999L0.707108 5.7071L4.85355 1.56066V12H5.85355V1.56066L9.99998 5.7071L10.7071 4.99999Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

export const InfoIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  // Circle + "i" info glyph in a padded 16x16 box, mirroring the Figma info icon.
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
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

export const CloseIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <path
      d="M8 8.70711L11.6464 12.3536L12.3536 11.6464L8.70711 8L12.3536 4.35355L11.6464 3.64645L8 7.29289L4.35355 3.64645L3.64645 4.35355L7.29289 8L3.64645 11.6464L4.35355 12.3536L8 8.70711Z"
      fill="currentColor"
    />
  </svg>
);

export const MoreIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
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

// Toolbar "+" (thin plus) — Figma 13x13 glyph centered in a padded 16x16 box (+1.5,+1.5).
export const PlusIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <path
      transform="translate(1.5 1.5)"
      d="M13 6V7H7V13H6V7H0V6H6V0H7V6H13Z"
      fill="currentColor"
    />
  </svg>
);

// Toolbar "/" (slash inside a rounded square) — Figma 13x13 glyph centered in a padded 16x16 box.
export const SlashBoxIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <g transform="translate(1.5 1.5)">
      <path
        d="M4.82275 10.3555H3.72607L8.16748 2.64453H9.27393L4.82275 10.3555Z"
        fill="currentColor"
      />
      <path
        d="M0.5 0H12.5L13 0.5V12.5L12.5 13H0.5L0 12.5V0.5L0.5 0ZM1 12H12V1H1V12Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

// Queue header chevron — Figma content-tight right arrow (5.28539 x 9.95205) centered
// in a padded 16x16 box. Points right by default; rotate via CSS for expanded state.
export const QueueChevronIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <path
      transform="translate(5.36 3.02)"
      d="M4.35731 4.97603L0 0.618718L0.618718 0L5.28539 4.66667V5.28538L0.618718 9.95205L0 9.33333L4.35731 4.97603Z"
      fill="currentColor"
    />
  </svg>
);

// Queue item action: edit (pencil) — Figma 11.934 x 11.9471 glyph centered in a 16x16 box.
export const QueueEditIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <path
      transform="translate(2.03 2.03)"
      d="M7.9664 0.439283C8.55216 -0.146457 9.50171 -0.146398 10.0875 0.439283L11.4947 1.84553C12.0803 2.43133 12.0804 3.38189 11.4947 3.9676L4.38633 11.076C4.32169 11.1405 4.23969 11.1861 4.15098 11.2078L1.23789 11.9178C0.511875 12.0948 -0.14489 11.4416 0.0279284 10.7147L0.725194 7.78499C0.746603 7.69518 0.792789 7.61302 0.858007 7.54768L7.9664 0.439283ZM1.66562 8.15413L1.00058 10.9461L3.7789 10.2684L8.45469 5.59163L6.3414 3.47835L1.66562 8.15413ZM9.38047 1.14631C9.1852 0.951157 8.86867 0.951098 8.67344 1.14631L7.04844 2.77131L9.16172 4.8846L10.7877 3.26057C10.9829 3.06538 10.9827 2.74784 10.7877 2.55256L9.38047 1.14631Z"
      fill="currentColor"
    />
  </svg>
);

// Queue item action: send now (up arrow) — Figma 10.7071 x 12 glyph centered in a 16x16 box.
export const QueueSendIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <path
      transform="translate(2.65 2)"
      d="M10.7071 4.99999L5.70711 0H5L0 4.99999L0.707108 5.7071L4.85355 1.56066V12H5.85355V1.56066L9.99998 5.7071L10.7071 4.99999Z"
      fill="currentColor"
    />
  </svg>
);

// Queue item action: delete (trash) — Figma 12.4329 x 13 glyph centered in a 16x16 box.
export const QueueTrashIcon: React.FC<IconProps> = ({ className = 'header-icon' }) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={className}>
    <g transform="translate(1.78 1.5)">
      <path d="M5.14941 4.12191V10.2623H4.13673V4.12191H5.14941Z" fill="currentColor" />
      <path d="M8.29618 4.12191V10.2623H7.28348V4.12191H8.29618Z" fill="currentColor" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.01771 0C7.88318 1.28547e-06 8.59523 0.657804 8.68051 1.50076L8.68742 1.56893H11.6317V1.57289H12.4329V2.58557H11.6317V10.7464C11.6317 11.9909 10.6226 12.9999 9.37803 13H3.05487C1.81034 12.9999 0.801262 11.9909 0.801262 10.7464V2.58557H0V1.57289H0.801262V1.56893H3.74548L3.75239 1.50076C3.83767 0.657798 4.54971 0 5.41519 0H7.01771ZM1.81396 2.58557V10.7464C1.81396 11.4316 2.3698 11.9872 3.05487 11.9873H9.37803C10.0631 11.9872 10.6179 11.4316 10.6179 10.7464V2.58557H1.81396ZM5.41519 1.0127C5.1216 1.0127 4.87272 1.20493 4.78781 1.47013L4.7562 1.56893H7.6767L7.64509 1.47013C7.56018 1.20494 7.31129 1.0127 7.01771 1.0127H5.41519Z"
        fill="currentColor"
      />
    </g>
  </svg>
);
