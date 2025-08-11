import React from 'react';
import { Box, Text, useStdin } from 'ink';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { NonRawInput } from './NonRawInput';
import { LoginForm } from './LoginForm';
import { useChat } from '../contexts/useChat';
import { logger } from '../utils/logger';

export const ChatInterface: React.FC = () => {
  const { messages, isCommandRunning, isLoading, sessionId, showLoginForm, setShowLoginForm, insertToInput, totalTokens } =
    useChat();
  const { isRawModeSupported } = useStdin();

  // 检查环境变量是否禁用了 raw mode
  const isRawModeDisabled = process.env.DISABLE_RAW_MODE === 'true';
  const shouldUseRawMode = isRawModeSupported && !isRawModeDisabled;

  // 处理登录成功
  const handleLoginSuccess = (userName: string) => {
    logger.debug('Login successful for user:', userName);
    setShowLoginForm(false);

    // 插入成功消息到输入框
    insertToInput(`# 登录成功！用户: ${userName}`);
  };

  // 处理登录取消
  const handleLoginCancel = () => {
    setShowLoginForm(false);
  };

  // 如果显示登录表单，只显示登录表单
  if (showLoginForm) {
    return (
      <Box flexDirection="column" height="100%" justifyContent="center">
        <LoginForm onSuccess={handleLoginSuccess} onCancel={handleLoginCancel} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {/* 只在 raw mode 下显示 MessageList */}
        {shouldUseRawMode && (
          <MessageList 
            messages={messages} 
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
          />
        )}
      </Box>

      {shouldUseRawMode ? <InputBox /> : <NonRawInput />}

      {/* Session ID 和 Token 统计显示 */}
      <Box paddingX={1} marginTop={1}>
        <Text color="gray" dimColor>
          Session ID: <Text color="blue">{sessionId}</Text>
          {' | '}
          Total Tokens: <Text color="green">{totalTokens.toLocaleString()}</Text>
        </Text>
      </Box>
    </Box>
  );
};
