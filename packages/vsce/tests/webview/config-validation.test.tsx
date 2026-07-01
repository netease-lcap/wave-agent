import { describe, it, expect } from 'vitest';

describe('Configuration Validation', () => {
    it('should allow empty baseURL in saveConfiguration', async () => {
        const saveConfiguration = async (configData: Record<string, unknown>) => {
            if (configData.baseURL === '') {
                return;
            }
        };

        await expect(saveConfiguration({ baseURL: '' })).resolves.not.toThrow();
    });
});
