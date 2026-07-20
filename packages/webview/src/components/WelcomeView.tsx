/**
 * WelcomeView - Centered welcome page for unauthenticated / empty-chat state.
 *
 * Shown in place of MessageList when the user is not logged in, or when logged
 * in but there are no messages yet. The login button + second description line
 * are only rendered when not authenticated.
 *
 * Design ref: Figma 2171:1482.
 */

import React from 'react';

export interface WelcomeViewProps {
  isAuthenticated: boolean;
  onLogin: () => void;
}

// Wave "W" mark from the Figma design (node 2171:1482 logo vector).
const WaveLogo: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size * (15.104 / 25.5993)}
    viewBox="0 0 25.5993 15.104"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <path
      d="M2.32466 12.9419C3.04151 13.6243 3.86207 14.1524 4.78633 14.526C5.7398 14.9113 6.73593 15.104 7.77473 15.104H12.5072C12.5851 15.104 12.6533 15.0752 12.7119 15.0176C12.7518 14.9782 12.7783 14.9344 12.7915 14.8859L13.9954 13.1584L14.0015 13.1465C14.0563 13.0384 14.0585 12.9345 14.0078 12.8348C13.951 12.7231 13.858 12.6672 13.7285 12.6672H7.67293C6.96043 12.6672 6.27962 12.5314 5.63051 12.2597C5.00214 11.9967 4.44748 11.6255 3.96652 11.1461C3.48429 10.6655 3.11394 10.1136 2.85544 9.49056C2.58707 8.84372 2.45889 8.16525 2.47092 7.45516C2.48292 6.7705 2.63214 6.11627 2.91857 5.49251C3.1943 4.89205 3.57848 4.35875 4.0711 3.89258C4.56134 3.42865 5.12142 3.0666 5.75134 2.8064C6.39978 2.53854 7.07532 2.39864 7.77799 2.38672H12.609C12.6953 2.38672 12.7741 2.35163 12.8454 2.28149L12.8581 2.26904L14.0972 0.49113L14.1032 0.479248C14.1581 0.371192 14.1603 0.267354 14.1096 0.167643C14.0528 0.0559081 13.9597 0 13.8303 0H7.67293C6.6227 0 5.61914 0.201072 4.66222 0.603272C3.73841 0.991561 2.92209 1.53936 2.21329 2.24658C1.50448 2.95381 0.958726 3.7651 0.576002 4.68042C0.179579 5.6285 -0.0122216 6.61985 0.000602802 7.65454C0.0054108 8.03761 0.038572 8.41397 0.10009 8.78361C0.134957 8.99312 0.178923 9.20052 0.232007 9.40576C0.335027 9.80398 0.472363 10.1941 0.643995 10.5761C1.04481 11.4682 1.60502 12.2568 2.32466 12.9419ZM16.7891 14.9207L13.9053 9.73324C13.7977 9.5397 13.7979 9.30431 13.9056 9.11084L16.7718 3.96533L16.7905 3.94661C16.861 3.87555 16.9395 3.84001 17.0258 3.84001H18.9098C19.0387 3.84001 19.1311 3.8963 19.1871 4.00895C19.236 4.10749 19.2339 4.21021 19.1809 4.31706L19.1789 4.32088L19.1769 4.32471L16.5245 9.1123C16.4177 9.3051 16.4176 9.53923 16.5243 9.7321L19.2286 14.6231L19.2305 14.627C19.2857 14.7382 19.2776 14.8477 19.2062 14.9556C19.1407 15.0545 19.0584 15.104 18.9593 15.104H17.0754C16.9064 15.104 16.811 15.0429 16.7891 14.9207ZM22.8995 9.1123L20.2471 4.32471L20.2451 4.32088L20.2431 4.31706C20.19 4.21021 20.188 4.10747 20.2369 4.00895C20.2929 3.8963 20.3853 3.84001 20.5143 3.84001H22.3982C22.4845 3.84001 22.563 3.87555 22.6336 3.94661L22.6522 3.96533L25.5185 9.11084C25.6262 9.30431 25.6263 9.5397 25.5187 9.73324L22.6349 14.9206C22.6131 15.0428 22.5176 15.104 22.3486 15.104H20.4647C20.3656 15.104 20.2834 15.0545 20.2179 14.9556C20.1464 14.8477 20.1383 14.7382 20.1935 14.627L20.1955 14.6231L22.8998 9.73218C23.0064 9.53931 23.0063 9.3051 22.8995 9.1123Z"
      fill="white"
    />
  </svg>
);

const FONT_FAMILY = '"PingFang SC", var(--vscode-font-family, sans-serif)';

const WelcomeView: React.FC<WelcomeViewProps> = ({ isAuthenticated, onLogin }) => {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          width: '400px',
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          padding: '0 16px',
        }}
      >
        {/* Logo */}
        <div
          style={{
            width: '32px',
            height: '32px',
            background: 'var(--vscode-brand-primary, #c1292e)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <WaveLogo size={20} />
        </div>

        {/* Text area */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            textAlign: 'center',
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
              fontWeight: 600,
              color: 'var(--vscode-button-foreground, white)',
              lineHeight: '18px',
            }}
          >
            Hi~ 欢迎使用 Wave 代码智聊
          </div>
          <div
            style={{
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
              fontWeight: 400,
              color: 'var(--vscode-descriptionForeground, #8c8c8c)',
              lineHeight: '26px',
            }}
          >
            我是您的AI助手，可以帮您处理项目、编写代码或修改文件。
          </div>
          {!isAuthenticated && (
            <div
              style={{
                fontSize: '13px',
                fontFamily: FONT_FAMILY,
                fontWeight: 400,
                color: 'var(--vscode-descriptionForeground, #8c8c8c)',
                lineHeight: '26px',
              }}
            >
              登录后即可开始使用~
            </div>
          )}
        </div>

        {/* Login button (unauthenticated only) — full-width, label centered */}
        {!isAuthenticated && (
          <button
            type="button"
            onClick={onLogin}
            style={{
              width: '100%',
              height: '32px',
              minHeight: '32px',
              background: 'var(--vscode-brand-primary, #c1292e)',
              color: 'var(--vscode-button-foreground, white)',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
              fontWeight: 600,
              lineHeight: '18px',
              cursor: 'pointer',
              padding: '7px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            登 录
          </button>
        )}
      </div>
    </div>
  );
};

export default WelcomeView;
