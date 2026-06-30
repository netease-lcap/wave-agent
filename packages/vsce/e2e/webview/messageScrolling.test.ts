import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Message List Scrolling', () => {
    test('should stop auto-scrolling when user scrolls up and resume when near bottom', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // 1. Add enough messages to make the container scrollable
        const messages = [];
        for (let i = 0; i < 20; i++) {
            messages.push({
                id: `msg_${i}`,
                role: 'assistant',
                blocks: [{ type: 'text', content: `Message line ${i}\n`.repeat(5) }]
            });
        }
        await injector.updateMessages(messages);

        // Wait for initial scroll to bottom
        const container = webviewPage.getByTestId('messages-container');
        await expect(async () => {
            const scrollTop = await container.evaluate(el => el.scrollTop);
            const scrollHeight = await container.evaluate(el => el.scrollHeight);
            const clientHeight = await container.evaluate(el => el.clientHeight);
            expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - 10);
        }).toPass();

        // 2. Start streaming a long message
        await injector.startStreaming();
        
        let accumulated = 'Streaming line 1\n';
        await injector.updateMessages([...messages, {
            id: 'streaming_msg',
            role: 'assistant',
            blocks: [{ type: 'text', content: accumulated }]
        }]);

        // 3. Manually scroll up
        await container.evaluate(el => el.scrollTop = 0);
        // Wait for scroll event to be processed
        await expect(async () => {
            const scrollTop = await container.evaluate(el => el.scrollTop);
            expect(scrollTop).toBe(0);
        }).toPass();

        // 4. Continue streaming and verify it DOES NOT scroll to bottom
        accumulated += 'Streaming line 2\n'.repeat(10);
        await injector.updateMessages([...messages, {
            id: 'streaming_msg',
            role: 'assistant',
            blocks: [{ type: 'text', content: accumulated }]
        }]);

        const scrollTopAfterUpdate = await container.evaluate(el => el.scrollTop);
        expect(scrollTopAfterUpdate).toBe(0);

        // 5. Scroll back to bottom
        await container.evaluate(el => {
            el.scrollTop = el.scrollHeight - el.clientHeight;
        });

        // 6. Continue streaming and verify it DOES scroll to bottom again
        accumulated += 'Streaming line 3\n'.repeat(10);
        await injector.updateMessages([...messages, {
            id: 'streaming_msg',
            role: 'assistant',
            blocks: [{ type: 'text', content: accumulated }]
        }]);

        await expect(async () => {
            const scrollTop = await container.evaluate(el => el.scrollTop);
            const scrollHeight = await container.evaluate(el => el.scrollHeight);
            const clientHeight = await container.evaluate(el => el.clientHeight);
            expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - 10);
        }).toPass();

        // 7. Send a NEW message and verify it FORCES scroll to bottom even if user scrolled up
        await container.evaluate(el => el.scrollTop = 0);
        // Wait for scroll event to be processed
        await expect(async () => {
            const scrollTop = await container.evaluate(el => el.scrollTop);
            expect(scrollTop).toBe(0);
        }).toPass();

        await injector.updateMessages([...messages, {
            id: 'streaming_msg',
            role: 'assistant',
            blocks: [{ type: 'text', content: accumulated }]
        }, {
            id: 'new_msg',
            role: 'user',
            blocks: [{ type: 'text', content: 'New message' }]
        }]);

        await expect(async () => {
            const scrollTop = await container.evaluate(el => el.scrollTop);
            const scrollHeight = await container.evaluate(el => el.scrollHeight);
            const clientHeight = await container.evaluate(el => el.clientHeight);
            expect(scrollTop + clientHeight).toBeGreaterThanOrEqual(scrollHeight - 10);
        }).toPass();

        // 8. Add a NEW assistant message and verify it DOES NOT force scroll to bottom if user scrolled up
        await container.evaluate(el => el.scrollTop = 0);
        // Wait for scroll event to be processed before updating messages
        await expect(async () => {
            const scrollTop = await container.evaluate(el => el.scrollTop);
            expect(scrollTop).toBe(0);
        }).toPass();

        await injector.updateMessages([...messages, {
            id: 'streaming_msg',
            role: 'assistant',
            blocks: [{ type: 'text', content: accumulated }]
        }, {
            id: 'new_msg',
            role: 'user',
            blocks: [{ type: 'text', content: 'New message' }]
        }, {
            id: 'new_assistant_msg',
            role: 'assistant',
            blocks: [{ type: 'text', content: 'New assistant message' }]
        }]);

        // Verify we are still at the top
        const scrollTopAfterAssistantMsg = await container.evaluate(el => el.scrollTop);
        expect(scrollTopAfterAssistantMsg).toBe(0);

        await injector.endStreaming();
    });
});
