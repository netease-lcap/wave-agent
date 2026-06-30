import { test as base, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

declare global {
    interface Window {
        simulateExtensionMessage: (message: Record<string, unknown>) => void;
        getTestMessages: () => Record<string, unknown>[];
        clearTestMessages: () => void;
        testMessages: Record<string, unknown>[];
        sentMessages: Record<string, unknown>[];
        capturePermissionMessage: (msg: Record<string, unknown>) => void;
        captureModelMessage: (msg: Record<string, unknown>) => void;
        captureQueueMessage: (msg: Record<string, unknown>) => void;
        captureRichInputMessage: (msg: Record<string, unknown>) => void;
        captureSlashMessage: (msg: Record<string, unknown>) => void;
        captureTagMessage: (msg: Record<string, unknown>) => void;
        captureToolMessage: (msg: Record<string, unknown>) => void;
        captureUploadMessage: (msg: Record<string, unknown>) => void;
        captureFilterMessage: (msg: Record<string, unknown>) => void;
        captureMessage: (msg: Record<string, unknown>) => void;
        captureMessageForTag: (msg: Record<string, unknown>) => void;
        captureMessageForImageTag: (msg: Record<string, unknown>) => void;
        capturePreviewMessage: (msg: Record<string, unknown>) => void;
        vscode: {
            postMessage: (message: Record<string, unknown>) => void;
        };
    }
}

/**
 * Extended test context for webview testing
 */
type WebviewTestContext = {
    webviewPage: Page;
};

/**
 * Custom test fixture that loads the chat webview in isolation
 */
export const test = base.extend<WebviewTestContext>({
    webviewPage: async ({ page }, use) => {

        // Enable error tracking
        page.on('pageerror', (error) => {
            console.error('Page error:', error);
        });

        // Load the React webview app for testing
        const webviewDistPath = path.join(process.cwd(), 'webview', 'dist');
        const vscodeStylesPath = path.join(process.cwd(), 'e2e', 'utils', 'vscode-styles.css');

        let vscodeStyles = '';
        if (fs.existsSync(vscodeStylesPath)) {
            vscodeStyles = fs.readFileSync(vscodeStylesPath, 'utf8');
        }

        // Resolve codicons paths for local serving (avoid CDN)
        const codiconsCssPath = path.join(process.cwd(), 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css');
        const codiconsTtfPath = path.join(process.cwd(), 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');

        // Serve the webview files through a mock server that simulates vscode-webview:// protocol
        await page.route('vscode-webview://**', (route, request) => {
            const url = new URL(request.url());
            const pathname = url.pathname;

            // Remove leading slash and map to actual file
            const filename = pathname.substring(1);

            // Serve codicons from local node_modules instead of CDN
            if (filename === 'codicons/codicon.css' && fs.existsSync(codiconsCssPath)) {
                route.fulfill({
                    status: 200,
                    contentType: 'text/css',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: fs.readFileSync(codiconsCssPath)
                });
                return;
            }
            if (filename === 'codicons/codicon.ttf' && fs.existsSync(codiconsTtfPath)) {
                route.fulfill({
                    status: 200,
                    contentType: 'font/ttf',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: fs.readFileSync(codiconsTtfPath)
                });
                return;
            }

            const filePath = path.join(webviewDistPath, filename);

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath);
                const ext = path.extname(filename);

                let contentType = 'application/octet-stream';
                if (ext === '.js') contentType = 'application/javascript';
                else if (ext === '.css') contentType = 'text/css';
                else if (ext === '.ttf') contentType = 'font/ttf';
                else if (ext === '.woff') contentType = 'font/woff';
                else if (ext === '.woff2') contentType = 'font/woff2';

                route.fulfill({
                    status: 200,
                    contentType,
                    headers: {
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: content
                });
            } else {
                route.fulfill({
                    status: 404,
                    body: `File not found: ${filename}`
                });
            }
        });

        // Create a minimal HTML page that matches the React app structure
        const testHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave AI Chat</title>
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/codicons/codicon.css">
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/chat.css">
    <style>
        /* Global VS Code CSS Variables for Testing */
        ${vscodeStyles}

        /* Ensure body has proper styling */
        body {
            margin: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        #root {
            width: 100%;
            height: 100vh;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        ${mockVscodeApiJs}
    </script>
    <script src="vscode-webview://mock-extension-id/chat.js"></script>
</body>
</html>`;

        // Load the HTML content
        await page.setContent(testHtml);

        // Wait for the React app to render by checking for the chat container
        // This is much faster than a fixed timeout
        await page.waitForSelector('[data-testid="chat-container"]', { 
            timeout: 3000 
        });

        await use(page);
    }
});

/**
 * Mock VS Code API for testing
 */
const mockVscodeApiJs = `
    // Mock Node.js globals that React bundle expects
    window.process = {
        env: {
            NODE_ENV: 'production'
        }
    };
    
    // Mock VS Code API
    let messageHandlers = [];
    
    window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
            
            // Store messages for test verification
            if (!window.testMessages) window.testMessages = [];
            window.testMessages.push(message);
            
            // Emit event for test listening
            window.dispatchEvent(new CustomEvent('vscode-message', { detail: message }));
        },
        setState: (state) => {
            // Mock setState
        },
        getState: () => {
            return {};
        }
    });

    // Helper to simulate messages from extension
    window.simulateExtensionMessage = (message) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: message
        }));
    };

    // Helper to get messages sent to extension
    window.getTestMessages = () => {
        return window.testMessages || [];
    };

    // Helper to clear test messages
    window.clearTestMessages = () => {
        window.testMessages = [];
    };
`;

export { expect };