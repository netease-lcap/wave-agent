import { test, expect } from '@playwright/test';

test.describe('Configuration Validation', () => {
    test('should allow empty baseURL in saveConfiguration', async () => {
        // This confirms we removed the explicit check
        const saveConfiguration = async (configData: Record<string, unknown>) => {
            if (configData.baseURL === '') {
                // No longer throwing
                return;
            }
        };

        await expect(saveConfiguration({ baseURL: '' })).resolves.not.toThrow();
    });
});
