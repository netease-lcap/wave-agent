/**
 * Test fixtures for streaming scenarios
 * Simulates the streaming behavior of the agent
 */

export interface StreamingScenario {
    name: string;
    chunks: string[];
    finalContent: string;
    shouldAbort?: boolean;
    abortAtChunk?: number;
}

export class StreamingFixtures {
    /**
     * Basic streaming scenario with incremental text
     */
    static readonly BASIC_STREAMING: StreamingScenario = {
        name: "Basic streaming response",
        chunks: [
            "I'll help",
            " you with",
            " that. Let me",
            " analyze your",
            " code and provide",
            " suggestions."
        ],
        finalContent: "I'll help you with that. Let me analyze your code and provide suggestions."
    };

    /**
     * Code explanation streaming scenario
     */
    static readonly CODE_EXPLANATION: StreamingScenario = {
        name: "Code explanation streaming",
        chunks: [
            "Looking at your code,",
            " I can see that",
            " this function handles",
            " user input validation.",
            " Here are some improvements:\n\n",
            "1. Add error handling\n",
            "2. Validate input types\n",
            "3. Return meaningful errors"
        ],
        finalContent: "Looking at your code, I can see that this function handles user input validation. Here are some improvements:\n\n1. Add error handling\n2. Validate input types\n3. Return meaningful errors"
    };

    /**
     * Streaming scenario that should be aborted
     */
    static readonly ABORTED_STREAMING: StreamingScenario = {
        name: "Aborted streaming response",
        chunks: [
            "I'm going to",
            " write a very",
            " long response",
            " that will be",
            " interrupted..."
        ],
        finalContent: "I'm going to write a very long response that will be",
        shouldAbort: true,
        abortAtChunk: 3
    };

    /**
     * Get all available streaming scenarios
     */
    static getAllScenarios(): StreamingScenario[] {
        return [
            this.BASIC_STREAMING,
            this.CODE_EXPLANATION, 
            this.ABORTED_STREAMING
        ];
    }

    /**
     * Simulate streaming by returning chunks one at a time
     */
    static async simulateStreaming(
        scenario: StreamingScenario, 
        onChunk: (chunk: string, accumulated: string) => void,
        chunkDelay: number = 100
    ): Promise<string> {
        let accumulated = "";

        for (let i = 0; i < scenario.chunks.length; i++) {
            const chunk = scenario.chunks[i];
            accumulated += chunk;

            onChunk(chunk, accumulated);

            // Simulate abort at specified chunk
            if (scenario.shouldAbort && scenario.abortAtChunk && i >= scenario.abortAtChunk) {
                return scenario.finalContent;
            }

            // Wait before next chunk
            await new Promise(resolve => setTimeout(resolve, chunkDelay));
        }

        return accumulated;
    }
}