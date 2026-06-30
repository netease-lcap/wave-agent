/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';

/**
 * Test /model dialog with dropdown select instead of text input.
 * The dialog should show <select> elements populated with configured models from the SDK.
 */

test.describe('Model Dialog Dropdown', () => {
  test('should show select dropdowns populated with configured models', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          model: 'gpt-4',
          fastModel: 'gpt-4-mini',
        }
      });
    });

    // Simulate extension sending configured models list
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configuredModelsResponse',
        models: ['gpt-4', 'gpt-4-mini', 'gpt-4-turbo', 'claude-3-opus', 'claude-3-sonnet']
      });
    });

    // Type /model and press Enter
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    // Verify model dialog is visible
    await expect(webviewPage.getByText('模型设置', { exact: true })).toBeVisible();

    // Verify select elements exist (not text inputs)
    const modelSelect = webviewPage.locator('#model-select');
    await expect(modelSelect).toBeVisible();
    const fastModelSelect = webviewPage.locator('#fast-model-select');
    await expect(fastModelSelect).toBeVisible();

    // Verify options are populated
    const modelOptions = modelSelect.locator('option');
    await expect(modelOptions).toHaveCount(5);
    await expect(modelOptions.nth(0)).toHaveText('gpt-4');
    await expect(modelOptions.nth(1)).toHaveText('gpt-4-mini');
    await expect(modelOptions.nth(2)).toHaveText('gpt-4-turbo');
    await expect(modelOptions.nth(3)).toHaveText('claude-3-opus');
    await expect(modelOptions.nth(4)).toHaveText('claude-3-sonnet');

    // Verify current model is selected
    await expect(modelSelect).toHaveValue('gpt-4');
    await expect(fastModelSelect).toHaveValue('gpt-4-mini');
  });

  test('should save selected model from dropdown', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          model: 'gpt-4',
          fastModel: 'gpt-4-mini',
        }
      });
    });

    // Simulate extension sending configured models list
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configuredModelsResponse',
        models: ['gpt-4', 'gpt-4-mini', 'claude-3-opus']
      });
    });

    // Open model dialog
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    // Change model via dropdown
    const modelSelect = webviewPage.locator('#model-select');
    await modelSelect.selectOption('claude-3-opus');

    // Click save
    await webviewPage.getByText('保存', { exact: true }).click();

    // Verify setModel message was sent with selected model
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    const setModelMsg = messages.find((m: Record<string, unknown>) => m.command === 'setModel');
    expect(setModelMsg).toBeDefined();
    expect((setModelMsg as any).configurationData.model).toBe('claude-3-opus');
    expect((setModelMsg as any).configurationData.fastModel).toBe('gpt-4-mini');
  });

  test('should show empty state when no configured models', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          model: 'gpt-4',
          fastModel: 'gpt-4-mini',
        }
      });
    });

    // Simulate extension sending empty configured models list
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configuredModelsResponse',
        models: []
      });
    });

    // Open model dialog
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    // Verify model dialog is visible
    await expect(webviewPage.getByText('模型设置', { exact: true })).toBeVisible();

    // Verify a hint about no models is shown
    await expect(webviewPage.locator('.model-empty-hint')).toBeVisible();
  });

  test('should request configured models when opening dialog', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Open model dialog
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    // Verify getConfiguredModels message was sent to extension
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    expect(messages.some((m: Record<string, unknown>) => m.command === 'getConfiguredModels')).toBe(true);
  });
});
