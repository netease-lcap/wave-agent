import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { Message } from 'wave-agent-sdk';

/**
 * Timeline connector geometry (设计稿: assistant 时间线竖线跨消息贯穿).
 *
 * Verifies the per-row `.timeline-row::after` segments inside a `.assistant-group`
 * abut seamlessly into one continuous vertical line, and that a single-dot group
 * (`.assistant-group--single`) draws no line.
 */
test.describe('Timeline connector geometry demo', () => {
    test('continuous line through a multi-assistant group; none for single group', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        const messages: Message[] = [
            {
                id: 'a1',
                role: 'assistant',
                timestamp: '2025-07-09T10:30:00.000Z',
                blocks: [{ type: 'text', content: 'First assistant message.' }],
            },
            {
                id: 'a2',
                role: 'assistant',
                timestamp: '2025-07-09T10:30:01.000Z',
                blocks: [{ type: 'text', content: 'Second assistant message.' }],
            },
            {
                id: 'u1',
                role: 'user',
                timestamp: '2025-07-09T10:30:02.000Z',
                blocks: [{ type: 'text', content: 'A follow-up question.' }],
            },
            {
                id: 'a3',
                role: 'assistant',
                timestamp: '2025-07-09T10:30:03.000Z',
                blocks: [{ type: 'text', content: 'Third assistant message.' }],
            },
        ];

        await injector.simulateExtensionMessage('setInitialState', {
            isAuthenticated: true,
            messages: [],
            isStreaming: false,
            sessions: [],
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514',
            },
            permissionMode: 'default',
        });

        await injector.updateMessages(messages);
        await injector.endStreaming();

        await webviewPage.waitForSelector('.assistant-group');

        // Geometry probe: for the first (multi-dot) group, read each timeline-row's
        // ::after top/height relative to the group box; for the single group read
        // the ::after display.
        const geo = await webviewPage.evaluate(() => {
            const px = (v: string) => (v && v.endsWith('px') ? parseFloat(v) : NaN);
            const groups = Array.from(document.querySelectorAll('.assistant-group'));

            const multi = groups[0] as HTMLElement;
            const single = groups[1] as HTMLElement;

            const multiRect = multi.getBoundingClientRect();
            const rows = Array.from(multi.querySelectorAll('.timeline-row')) as HTMLElement[];
            const segments = rows.map((row) => {
                const rect = row.getBoundingClientRect();
                const after = getComputedStyle(row, '::after');
                const afterTop = px(after.top);
                const afterHeight = px(after.height);
                // Row top relative to the group box.
                const rowTopInGroup = rect.top - multiRect.top;
                return {
                    rowTopInGroup,
                    rowHeight: rect.height,
                    afterDisplay: after.display,
                    afterTop,
                    afterHeight,
                    // Absolute (in-group) segment start/end.
                    segStart: rowTopInGroup + afterTop,
                    segEnd: rowTopInGroup + afterTop + afterHeight,
                };
            });

            // The ::before dots on the first and last rows, relative to their row.
            const firstDot = getComputedStyle(rows[0], '::before');
            const lastRow = rows[rows.length - 1];
            const lastDot = getComputedStyle(lastRow, '::before');
            const firstDotCenter =
                (rows[0].getBoundingClientRect().top - multiRect.top) + px(firstDot.top) + px(firstDot.height) / 2;
            const lastDotCenter =
                (lastRow.getBoundingClientRect().top - multiRect.top) + px(lastDot.top) + px(lastDot.height) / 2;

            const singleAfter = getComputedStyle(
                single.querySelector('.timeline-row') as HTMLElement,
                '::after'
            );

            return {
                rowCount: rows.length,
                segments,
                firstDotCenter,
                lastDotCenter,
                singleIsSingleClass: single.classList.contains('assistant-group--single'),
                singleAfterDisplay: singleAfter.display,
            };
        });

        // Sanity: two dots → two timeline rows in the multi group.
        expect(geo.rowCount).toBe(2);

        // Every segment in the multi group is drawn (not display:none).
        for (const seg of geo.segments) {
            expect(seg.afterDisplay).not.toBe('none');
        }

        // Segments abut seamlessly: row1's end ≈ row2's start (tolerance 1px).
        expect(Math.abs(geo.segments[0].segEnd - geo.segments[1].segStart)).toBeLessThanOrEqual(1);

        // First segment starts at the first dot center (dot top 15 + radius 3 = 18px).
        expect(Math.abs(geo.segments[0].segStart - geo.firstDotCenter)).toBeLessThanOrEqual(1);
        expect(Math.abs(geo.segments[0].segStart - 18)).toBeLessThanOrEqual(1);

        // Last segment ends at the last dot center.
        expect(Math.abs(geo.segments[geo.segments.length - 1].segEnd - geo.lastDotCenter)).toBeLessThanOrEqual(1);

        // The single-dot group draws no connecting line.
        expect(geo.singleIsSingleClass).toBe(true);
        expect(geo.singleAfterDisplay).toBe('none');
    });
});
