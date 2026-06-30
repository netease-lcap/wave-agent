import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Webview Ready Streaming State Restoration', () => {

    test('should restore streaming state when webview becomes ready during active streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Send initial message to establish conversation
        await ui.typeMessage('Hello');
        await ui.clickSend();
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Hello')
        ]);
        await ui.verifyMessageCount(2); // Welcome + user message

        // Start streaming response
        await injector.startStreaming();
        
        // Verify streaming state is active - use the correct method
        await ui.verifyStreamingMessageExists();

        // Simulate streaming content update
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Hello'),
            MockDataGenerator.createAssistantMessage('I am currently processing your request...')
        ]);

        await ui.verifyMessageCount(3); // Welcome + user message + streaming response
        
        // Simulate webview becoming ready again (e.g., when switching back to sidebar)
        // This should restore the streaming state
        await injector.sendWebviewReady();
        
        // Verify that streaming state is preserved after webview ready
        await ui.verifyStreamingMessageExists();
        
        // Continue streaming with more content
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Hello'),
            MockDataGenerator.createAssistantMessage('Processing complete. Here is your result...')
        ]);

        await ui.verifyLatestMessageContent('Processing complete. Here is your result...');
        
        // End streaming
        await injector.endStreaming();
        
        // Verify streaming state is properly ended
        await ui.verifyNoStreamingMessages();
        await ui.verifyAbortButtonVisible(false); // Use correct method with parameter
        await ui.verifyMessageCount(3); // Messages should remain the same
    });

    test('should not affect non-streaming state when webview becomes ready', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Send message and complete conversation without streaming
        await ui.sendMessage('Test message');
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Test message'),
            MockDataGenerator.createAssistantMessage('Complete response')
        ]);

        await ui.verifyMessageCount(3); // Welcome + user + assistant
        await ui.verifyNoStreamingMessages();
        await ui.verifyAbortButtonVisible(false); // Use correct method

        // Simulate webview becoming ready again
        await injector.sendWebviewReady();
        
        // Verify that no streaming state is activated
        await ui.verifyNoStreamingMessages();
        await ui.verifyAbortButtonVisible(false); // Use correct method
        await ui.verifyMessageCount(3); // Should remain the same
    });

    test('should handle multiple webview ready events during streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Start conversation and streaming
        await ui.typeMessage('Long running task');
        await ui.clickSend();
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Long running task')
        ]);
        await injector.startStreaming();
        
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Long running task'),
            MockDataGenerator.createAssistantMessage('Starting task...')
        ]);

        await ui.verifyStreamingMessageExists();

        // Multiple webview ready events (simulating user switching views rapidly)
        await injector.sendWebviewReady();
        await ui.verifyStreamingMessageExists();
        
        await injector.sendWebviewReady();
        await ui.verifyStreamingMessageExists();
        
        await injector.sendWebviewReady(); 
        await ui.verifyStreamingMessageExists();

        // Continue with streaming updates
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Long running task'),
            MockDataGenerator.createAssistantMessage('Task completed successfully.')
        ]);

        // End streaming
        await injector.endStreaming();
        await ui.verifyNoStreamingMessages();
    });
});