import type { Message, TextBlock, ToolBlock, ErrorBlock, MessageBlock, TaskNotificationBlock } from 'wave-agent-sdk';
import { 
    READ_TOOL_NAME, 
    WRITE_TOOL_NAME, 
    BASH_TOOL_NAME, 
    EDIT_TOOL_NAME 
} from 'wave-agent-sdk';

/**
 * Mock data generators for testing webview functionality
 * Based on actual wave-agent-sdk data structures
 */

export class MockDataGenerator {
    /**
     * Create a basic user message
     */
    static createUserMessage(content: string, id?: string): Message {
        const textBlock: TextBlock = {
            type: "text",
            content: content
        };

        return {
            id: id || `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "user",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [textBlock]
        };
    }

    /**
     * Create a basic assistant message with text content
     */
    static createAssistantMessage(content: string, id?: string): Message {
        const textBlock: TextBlock = {
            type: "text",
            content: content
        };

        return {
            id: id || `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [textBlock]
        };
    }

    /**
     * Create an assistant message with a tool call
     */
    static createAssistantMessageWithTool(textContent: string, toolName: string, toolParams: string, toolResult?: string): Message {
        const blocks: MessageBlock[] = [];

        if (textContent) {
            blocks.push({
                type: "text",
                content: textContent
            } as TextBlock);
        }

        const toolBlock: ToolBlock = {
            type: "tool",
            name: toolName,
            parameters: toolParams,
            compactParams: toolName === READ_TOOL_NAME ? "file.ts" : 
                          toolName === WRITE_TOOL_NAME ? "config.json" : 
                          toolName === BASH_TOOL_NAME ? "npm install" : 
                          `${toolName.toLowerCase()}`,
            result: toolResult,
            stage: toolResult ? "end" : "running",
            success: toolResult ? true : undefined,
            id: `tool_${Date.now()}`
        };

        blocks.push(toolBlock);

        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: blocks
        };
    }

    /**
     * Create an error message
     */
    static createErrorMessage(errorContent: string): Message {
        const errorBlock: ErrorBlock = {
            type: "error",
            content: errorContent
        };

        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [errorBlock]
        };
    }

    /**
     * Create a streaming message (partial content)
     */
    static createStreamingMessage(accumulatedContent: string): Message {
        const textBlock: TextBlock = {
            type: "text",
            content: accumulatedContent
        };

        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [textBlock]
        };
    }

    /**
     * Create an assistant message with a file editing tool (Edit, Write, MultiEdit)
     * that should trigger diff display
     */
    static createAssistantMessageWithFileEdit(
        textContent: string,
        toolName: typeof EDIT_TOOL_NAME | typeof WRITE_TOOL_NAME,
        filePath: string,
        editParams: Record<string, unknown>,
        stage: 'running' | 'end' = 'end'
    ): Message {
        const blocks: MessageBlock[] = [];

        if (textContent) {
            blocks.push({
                type: "text",
                content: textContent
            } as TextBlock);
        }

        const toolBlock: ToolBlock = {
            type: "tool",
            name: toolName,
            parameters: JSON.stringify({
                file_path: filePath,
                ...editParams
            }),
            compactParams: filePath,
            stage: stage,
            success: stage === 'end' ? true : undefined,
            id: `${toolName.toLowerCase()}_${Date.now()}`
        };

        blocks.push(toolBlock);

        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: blocks
        };
    }

    /**
     * Create a simple Edit tool message
     */
    static createEditToolMessage(filePath: string, oldString: string, newString: string): Message {
        return this.createAssistantMessageWithFileEdit(
            `Editing ${filePath}:`,
            EDIT_TOOL_NAME,
            filePath,
            { old_string: oldString, new_string: newString }
        );
    }

    /**
     * Create a simple Write tool message
     */
    static createWriteToolMessage(filePath: string, content: string): Message {
        return this.createAssistantMessageWithFileEdit(
            `Writing new file ${filePath}:`,
            WRITE_TOOL_NAME,
            filePath,
            { content: content }
        );
    }

    /**
     * Create an assistant message with a tool call that has an error
     */
    static createAssistantMessageWithToolError(textContent: string, toolName: string, toolParams: string, errorMessage: string): Message {
        const blocks: MessageBlock[] = [];

        if (textContent) {
            blocks.push({
                type: "text",
                content: textContent
            } as TextBlock);
        }

        const toolBlock: ToolBlock = {
            type: "tool",
            name: toolName,
            parameters: toolParams,
            compactParams: toolName === READ_TOOL_NAME ? "file.ts" : 
                          toolName === WRITE_TOOL_NAME ? "config.json" : 
                          toolName === BASH_TOOL_NAME ? "npm install" : 
                          `${toolName.toLowerCase()}`,
            stage: "end",
            success: false,
            id: `tool_${Date.now()}`,
            error: errorMessage
        } as ToolBlock;

        blocks.push(toolBlock);

        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: blocks
        };
    }
    /**
     * Create a bang message
     */
    static createBangMessage(command: string, output: string, isRunning: boolean = false, exitCode: number | null = 0): Message {
        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "user",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{
                type: "bang",
                command,
                output,
                stage: isRunning ? 'running' : 'end',
                exitCode
            } as MessageBlock]
        };
    }

    /**
     * Create an assistant message with a task notification block
     */
    static createAssistantMessageWithTaskNotification(
        textContent: string,
        taskId: string,
        taskType: 'shell' | 'agent' = 'shell',
        status: 'completed' | 'failed' | 'killed' = 'completed',
        summary?: string,
        outputFile?: string
    ): Message {
        const blocks: MessageBlock[] = [];

        if (textContent) {
            blocks.push({
                type: "text",
                content: textContent
            } as TextBlock);
        }

        const notificationBlock: TaskNotificationBlock = {
            type: "task_notification",
            taskId,
            taskType,
            status,
            summary: summary || `Task ${taskId} ${status}`,
        };
        if (outputFile) {
            notificationBlock.outputFile = outputFile;
        }

        blocks.push(notificationBlock);

        return {
            id: `msg_${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks
        };
    }

    static createSampleConversation(): Message[] {
        return [
            this.createUserMessage("Hello, can you help me with my project?"),
            this.createAssistantMessage("Hello! I'd be happy to help you with your project. What would you like to know?"),
            this.createUserMessage("Can you read the package.json file?"),
            this.createAssistantMessageWithTool(
                "I'll read the package.json file for you.", 
                READ_TOOL_NAME,
                '{"file_path": "/project/package.json"}',
                '{"name": "test-project", "version": "1.0.0"}'
            )
        ];
    }
}