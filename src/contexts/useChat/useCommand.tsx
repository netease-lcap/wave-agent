import { useState, useRef, useCallback } from 'react';
import type { Message } from '../../types';
import { spawn, type ChildProcess } from 'child_process';
import { addBashCommandToHistory } from '../../utils/bashHistory';

export interface CommandContextType {
  executeCommand: (command: string) => Promise<number>;
  abortCommand: () => void;
  isCommandRunning: boolean;
}

export const useCommand = (
  workdir: string,
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): CommandContextType => {
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const currentProcessRef = useRef<ChildProcess | null>(null);

  const executeCommand = useCallback(
    async (command: string): Promise<number> => {
      if (isCommandRunning) {
        throw new Error('Command already running');
      }

      setIsCommandRunning(true);

      // Add command output placeholder
      const outputMessage: Message = {
        role: 'assistant',
        blocks: [{ type: 'command_output', command, output: '', isRunning: true, exitCode: null }],
      };

      setMessages((prev: Message[]) => [...prev, outputMessage]);
      const outputMessageIndex = messages.length;

      return new Promise<number>((resolve) => {
        const child = spawn(command, {
          shell: true,
          stdio: 'pipe',
          cwd: workdir,
          env: {
            ...process.env,
          },
        });

        currentProcessRef.current = child;
        let outputBuffer = '';

        const updateOutput = (newData: string) => {
          outputBuffer += newData;
          setMessages((prev) => {
            const newMessages = [...prev];
            const outputMsg = newMessages[outputMessageIndex];
            if (outputMsg && outputMsg.role === 'assistant') {
              const commandBlock = outputMsg.blocks.find((block) => block.type === 'command_output');
              if (commandBlock && commandBlock.type === 'command_output') {
                commandBlock.output = outputBuffer.trim();
              }
            }
            return newMessages;
          });
        };

        child.stdout?.on('data', (data) => {
          updateOutput(data.toString());
        });

        child.stderr?.on('data', (data) => {
          updateOutput(data.toString());
        });

        child.on('exit', (code, signal) => {
          const exitCode = code === null && signal ? 130 : (code ?? 0);

          // 添加命令到bash历史记录
          addBashCommandToHistory(command, workdir, exitCode);

          setMessages((prev) => {
            const newMessages = [...prev];
            const outputMsg = newMessages[outputMessageIndex];
            if (outputMsg && outputMsg.role === 'assistant') {
              const commandBlock = outputMsg.blocks.find((block) => block.type === 'command_output');
              if (commandBlock && commandBlock.type === 'command_output') {
                commandBlock.isRunning = false;
                commandBlock.exitCode = exitCode;
              }
            }
            return newMessages;
          });

          setIsCommandRunning(false);
          currentProcessRef.current = null;
          resolve(exitCode);
        });

        child.on('error', (error) => {
          updateOutput(`\nError: ${error.message}\n`);
          setMessages((prev: Message[]) => {
            const newMessages = [...prev];
            const outputMsg = newMessages[outputMessageIndex];
            if (outputMsg && outputMsg.role === 'assistant') {
              const commandBlock = outputMsg.blocks.find((block) => block.type === 'command_output');
              if (commandBlock && commandBlock.type === 'command_output') {
                commandBlock.isRunning = false;
                commandBlock.exitCode = 1;
              }
            }
            return newMessages;
          });

          setIsCommandRunning(false);
          currentProcessRef.current = null;
          resolve(1);
        });
      });
    },
    [isCommandRunning, workdir, messages.length, setMessages],
  );

  const abortCommand = useCallback(() => {
    if (currentProcessRef.current && isCommandRunning) {
      currentProcessRef.current.kill('SIGKILL');
      currentProcessRef.current = null;
      setIsCommandRunning(false);
    }
  }, [isCommandRunning]);

  return {
    executeCommand,
    abortCommand,
    isCommandRunning,
  };
};
