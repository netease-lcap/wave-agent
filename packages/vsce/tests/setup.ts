import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; mock it so components that call it on mount don't throw
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
}

// jsdom does not have DataTransfer; polyfill a minimal version for paste/drop tests
if (typeof globalThis.DataTransfer === 'undefined') {
    class DataTransferPolyfill {
        items: { type: string; kind: string; getAsString: (cb: (s: string) => void) => void; getAsFile: () => File | null }[] = [];
        files: File[] = [];
        types: string[] = [];
        setData() {}
        getData() { return ''; }
        clearData() {}
        add(data: string | File, type?: string) {
            if (typeof data === 'string') {
                this.types.push(type || 'text/plain');
                return null;
            }
            this.items.push({ type: data.type, kind: 'file', getAsString: () => {}, getAsFile: () => data });
            this.files.push(data);
            this.types.push('Files');
            return { type: data.type, kind: 'file', getAsString: () => {}, getAsFile: () => data };
        }
    }
    (globalThis as unknown as Record<string, unknown>).DataTransfer = DataTransferPolyfill;
}

// jsdom does not implement innerText getter; polyfill it using textContent.
// The webview's MessageInput component reads `element.innerText` to sync state,
// and jsdom returns undefined for the getter, causing `message.trim()` to crash.
if (typeof HTMLElement !== 'undefined') {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    if (!desc || !desc.get) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', {
            get() {
                return this.textContent || '';
            },
            set(value: string) {
                this.textContent = value ?? '';
            },
            configurable: true,
        });
    }
}
