import React from 'react';
import { Box, Text, useInput } from 'ink';
import { logger } from '../utils/logger.js';

export interface LoginFormProps {
  onSuccess: (userName: string) => void;
  onCancel: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess, onCancel }) => {
  const handleNoAuth = () => {
    logger.info('Using OpenAI - no authentication required');
    onSuccess('OpenAI User');
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      handleNoAuth();
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" padding={1} marginBottom={1}>
      <Text color="cyan" bold>
        🔐 OpenAI 配置
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>使用 OpenAI API，无需登录认证</Text>
        <Text color="green">请确保已设置环境变量：</Text>
        <Text color="gray">- OPENAI_API_KEY</Text>
        <Text color="gray">- OPENAI_BASE_URL (可选)</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Enter 继续，Escape 取消</Text>
      </Box>
    </Box>
  );
};
