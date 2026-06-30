import { describe, it, expect } from 'vitest';
import { chatReducer, initialState } from '../../webview/src/reducers/chatReducer';
import type { Message, TextBlock, ToolBlock, ReasoningBlock } from '../../webview/src/types';

describe('chatReducer', () => {
  describe('APPEND_MESSAGE', () => {
    it('should append a new message to the end of the list', () => {
      const existingMessage: Message = {
        id: 'msg-1',
        role: 'user',
        timestamp: '0',
        blocks: []
      };
      const state = { ...initialState, messages: [existingMessage] };

      const newMessage: Message = {
        id: 'msg-2',
        role: 'assistant',
        timestamp: '0',
        blocks: []
      };

      const newState = chatReducer(state, { type: 'APPEND_MESSAGE', payload: newMessage });

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0]).toBe(existingMessage);
      expect(newState.messages[1]).toBe(newMessage);
    });

    it('should append to empty message list', () => {
      const state = { ...initialState, messages: [] };
      const newMessage: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: []
      };

      const newState = chatReducer(state, { type: 'APPEND_MESSAGE', payload: newMessage });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toBe(newMessage);
    });
  });

  describe('UPDATE_STREAMING_CONTENT', () => {
    it('should update existing text block content and stage', () => {
      const textBlock: TextBlock = {
        type: 'text',
        content: 'Hello',
        stage: 'streaming'
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: [textBlock]
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_CONTENT',
        payload: { messageId: 'msg-1', accumulated: 'Hello World', stage: 'streaming' }
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].blocks).toHaveLength(1);
      const updatedBlock = newState.messages[0].blocks[0] as TextBlock;
      expect(updatedBlock.content).toBe('Hello World');
      expect(updatedBlock.stage).toBe('streaming');
    });

    it('should update stage to end', () => {
      const textBlock: TextBlock = {
        type: 'text',
        content: 'Hello',
        stage: 'streaming'
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: [textBlock]
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_CONTENT',
        payload: { messageId: 'msg-1', accumulated: 'Hello', stage: 'end' }
      });

      const updatedBlock = newState.messages[0].blocks[0] as TextBlock;
      expect(updatedBlock.stage).toBe('end');
    });

    it('should append text block if none exists', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: []
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_CONTENT',
        payload: { messageId: 'msg-1', accumulated: 'Hello', stage: 'streaming' }
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const newBlock = newState.messages[0].blocks[0] as TextBlock;
      expect(newBlock.type).toBe('text');
      expect(newBlock.content).toBe('Hello');
      expect(newBlock.stage).toBe('streaming');
    });

    it('should return original state if messageId not found', () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_CONTENT',
        payload: { messageId: 'non-existent', accumulated: 'Hello', stage: 'streaming' }
      });

      expect(newState).toBe(state);
    });
  });

  describe('UPDATE_STREAMING_REASONING', () => {
    it('should update existing reasoning block content and stage', () => {
      const reasoningBlock: ReasoningBlock = {
        type: 'reasoning',
        content: 'Thinking...',
        stage: 'streaming'
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: [reasoningBlock]
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_REASONING',
        payload: { messageId: 'msg-1', accumulated: 'Thinking... about this', stage: 'streaming' }
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const updatedBlock = newState.messages[0].blocks[0] as ReasoningBlock;
      expect(updatedBlock.content).toBe('Thinking... about this');
      expect(updatedBlock.stage).toBe('streaming');
    });

    it('should append reasoning block if none exists', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: []
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_REASONING',
        payload: { messageId: 'msg-1', accumulated: 'Thinking...', stage: 'streaming' }
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const newBlock = newState.messages[0].blocks[0] as ReasoningBlock;
      expect(newBlock.type).toBe('reasoning');
      expect(newBlock.content).toBe('Thinking...');
    });

    it('should return original state if messageId not found', () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: 'UPDATE_STREAMING_REASONING',
        payload: { messageId: 'non-existent', accumulated: 'Thinking...', stage: 'streaming' }
      });

      expect(newState).toBe(state);
    });
  });

  describe('UPDATE_TOOL_BLOCK', () => {
    it('should update existing tool block', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        id: 'tool-1',
        name: 'Bash',
        stage: 'running',
        parameters: '{"command":"ls"}',
        result: '',
        success: false
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: [toolBlock]
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_TOOL_BLOCK',
        payload: {
          messageId: 'msg-1',
          id: 'tool-1',
          name: 'Bash',
          stage: 'end',
          result: 'file1.txt\nfile2.txt',
          success: true,
          parameters: '{"command":"ls"}'
        }
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const updatedBlock = newState.messages[0].blocks[0] as ToolBlock;
      expect(updatedBlock.stage).toBe('end');
      expect(updatedBlock.result).toBe('file1.txt\nfile2.txt');
      expect(updatedBlock.success).toBe(true);
    });

    it('should return original state if messageId not found', () => {
      const state = { ...initialState, messages: [] };

      const newState = chatReducer(state, {
        type: 'UPDATE_TOOL_BLOCK',
        payload: {
          messageId: 'non-existent',
          id: 'tool-1',
          name: 'Bash',
          stage: 'end',
          result: '',
          success: false,
          parameters: '{}'
        }
      });

      expect(newState).toBe(state);
    });

    it('should add new tool block if not found (incremental callback scenario)', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: []
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_TOOL_BLOCK',
        payload: {
          messageId: 'msg-1',
          id: 'tool-new',
          name: 'Bash',
          stage: 'start',
          parameters: '{"command":"ls"}'
        }
      });

      expect(newState.messages[0].blocks).toHaveLength(1);
      const newBlock = newState.messages[0].blocks[0] as ToolBlock;
      expect(newBlock.type).toBe('tool');
      expect(newBlock.id).toBe('tool-new');
      expect(newBlock.name).toBe('Bash');
      expect(newBlock.stage).toBe('start');
      expect(newBlock.parameters).toBe('{"command":"ls"}');
    });

    it('should add tool block alongside existing blocks', () => {
      const textBlock: TextBlock = {
        type: 'text',
        content: 'Let me run a command',
        stage: 'end'
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        timestamp: '0',
        blocks: [textBlock]
      };
      const state = { ...initialState, messages: [message] };

      const newState = chatReducer(state, {
        type: 'UPDATE_TOOL_BLOCK',
        payload: {
          messageId: 'msg-1',
          id: 'tool-1',
          name: 'Bash',
          stage: 'running',
          parameters: '{"command":"ls"}'
        }
      });

      expect(newState.messages[0].blocks).toHaveLength(2);
      expect(newState.messages[0].blocks[0].type).toBe('text');
      const toolBlock = newState.messages[0].blocks[1] as ToolBlock;
      expect(toolBlock.type).toBe('tool');
      expect(toolBlock.id).toBe('tool-1');
      expect(toolBlock.stage).toBe('running');
    });
  });

  describe('SET_MESSAGES', () => {
    it('should replace entire message list', () => {
      const oldMessage: Message = { id: 'old', role: 'user', timestamp: '0', blocks: [] };
      const state = { ...initialState, messages: [oldMessage] };
      const newMessages: Message[] = [
        { id: 'new-1', role: 'user', timestamp: '0', blocks: [] },
        { id: 'new-2', role: 'assistant', timestamp: '0', blocks: [] }
      ];

      const newState = chatReducer(state, { type: 'SET_MESSAGES', payload: newMessages });

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0].id).toBe('new-1');
      expect(newState.messages[1].id).toBe('new-2');
    });
  });

  describe('User message flow', () => {
    it('should handle user message followed by assistant message', () => {
      const state = { ...initialState, messages: [] };

      // User sends a message
      const userMessage: Message = {
        id: 'user-1',
        role: 'user',
        timestamp: '0',
        blocks: [{ type: 'text', content: 'Hello', stage: 'end' }]
      };
      let newState = chatReducer(state, { type: 'APPEND_MESSAGE', payload: userMessage });
      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].role).toBe('user');

      // Assistant starts responding
      const assistantMessage: Message = {
        id: 'assistant-1',
        role: 'assistant',
        timestamp: '0',
        blocks: []
      };
      newState = chatReducer(newState, { type: 'APPEND_MESSAGE', payload: assistantMessage });
      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0].role).toBe('user');
      expect(newState.messages[1].role).toBe('assistant');

      // Assistant content streams in
      newState = chatReducer(newState, {
        type: 'UPDATE_STREAMING_CONTENT',
        payload: { messageId: 'assistant-1', accumulated: 'Hi there', stage: 'streaming' }
      });
      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[1].blocks).toHaveLength(1);
      expect((newState.messages[1].blocks[0] as TextBlock).content).toBe('Hi there');
    });
  });
});
