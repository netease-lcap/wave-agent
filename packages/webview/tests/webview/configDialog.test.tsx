import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfigDialog from '../../src/components/ConfigDialog';
import type { ConfigurationData, VsCodeApi } from '../../src/types';

vi.mock('../../src/styles/ConfigurationDialog.css', () => ({}));

const mockVscode = {
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
} as unknown as VsCodeApi;

function renderDialog(overrides?: {
  configurationData?: ConfigurationData;
  isLoading?: boolean;
  error?: string;
  onSave?: (config: ConfigurationData) => void;
  onCancel?: () => void;
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  onLoadProjectSettings?: () => void;
  onToggleBuiltinPlugin?: (pluginId: string, enabled: boolean) => void;
}) {
  const onSave = overrides?.onSave ?? vi.fn();
  const onCancel = overrides?.onCancel ?? vi.fn();
  const onLoadProjectSettings = overrides?.onLoadProjectSettings ?? vi.fn();
  const onToggleBuiltinPlugin = overrides?.onToggleBuiltinPlugin ?? vi.fn();
  const result = render(
    <ConfigDialog
      configurationData={overrides?.configurationData ?? { language: 'Chinese' }}
      isLoading={overrides?.isLoading ?? false}
      error={overrides?.error}
      onSave={onSave}
      onCancel={onCancel}
      projectSettings={overrides?.projectSettings}
      onLoadProjectSettings={onLoadProjectSettings}
      onToggleBuiltinPlugin={onToggleBuiltinPlugin}
      vscode={mockVscode}
    />
  );
  return { ...result, onSave, onCancel, onLoadProjectSettings, onToggleBuiltinPlugin };
}

describe('ConfigDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the header title and defaults to the global tab', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy();

    const globalTab = screen.getByRole('tab', { name: '全局设置' });
    const modelTab = screen.getByRole('tab', { name: '直连设置' });
    expect(globalTab.getAttribute('aria-selected')).toBe('true');
    expect(modelTab.getAttribute('aria-selected')).toBe('false');

    // Global tab shows the language select
    expect(screen.getByLabelText('语言 (Language)')).toBeTruthy();
    // Model tab fields not rendered yet
    expect(screen.queryByLabelText('API Key')).toBeNull();
  });

  it('switches to the model tab and renders model fields', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('tab', { name: '直连设置' }));

    expect(screen.getByRole('tab', { name: '直连设置' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('保存后，优先使用此配置，无需登录即可正常使用插件。')).toBeTruthy();
    expect(screen.getByLabelText('API Key')).toBeTruthy();
    expect(screen.getByLabelText('Base URL')).toBeTruthy();
    expect(screen.getByLabelText('Agent Model')).toBeTruthy();
    expect(screen.getByLabelText('Fast Model')).toBeTruthy();

    // Language select is hidden on the model tab
    expect(screen.queryByLabelText('语言 (Language)')).toBeNull();
  });

  it('renders Fast Model as an <input>, not a <select>', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: '直连设置' }));

    const fastModel = screen.getByLabelText('Fast Model');
    expect(fastModel.tagName).toBe('INPUT');
    expect(fastModel.getAttribute('placeholder')).toBe('请输入 Fast Model');
  });

  it('uses the correct placeholder text for Base URL', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: '直连设置' }));

    expect(screen.getByLabelText('Base URL').getAttribute('placeholder')).toBe('请输入 Base URL');
    expect(screen.getByLabelText('API Key').getAttribute('placeholder')).toBe('请输入 API Key');
  });

  it('saves the complete form data (all fields) on submit', () => {
    const { onSave } = renderDialog({
      configurationData: {
        language: 'English',
        apiKey: 'existing-key',
        baseURL: 'https://api.example.com',
        model: 'agent-model',
        fastModel: 'fast-model',
      },
    });

    fireEvent.click(screen.getByRole('tab', { name: '直连设置' }));

    const apiKey = screen.getByLabelText('API Key');
    fireEvent.change(apiKey, { target: { value: 'new-key' } });

    const fastModel = screen.getByLabelText('Fast Model');
    fireEvent.change(fastModel, { target: { value: 'new-fast' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      language: 'English',
      apiKey: 'new-key',
      baseURL: 'https://api.example.com',
      model: 'agent-model',
      fastModel: 'new-fast',
    });
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the close icon is clicked', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Escape is pressed', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not close on the same-tick mousedown that opened it, but closes on a later outside mousedown', () => {
    vi.useFakeTimers();
    try {
      const { onCancel } = renderDialog();

      // A mousedown outside the dialog dispatched on the same tick as mount
      // (the click that opened the dialog is still bubbling). It must NOT close.
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(onCancel).not.toHaveBeenCalled();

      // After the deferred listener registers, an outside mousedown closes it.
      vi.advanceTimersByTime(0);
      fireEvent.mouseDown(outside);
      expect(onCancel).toHaveBeenCalledTimes(1);

      document.body.removeChild(outside);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── 项目设置 tab ─────────────────────────────────────────────────
  it('switches to the 项目设置 tab and renders the SDD toggle', () => {
    renderDialog({ projectSettings: { enabledPlugins: { 'sdd@builtin': false } } });

    fireEvent.click(screen.getByRole('tab', { name: '项目设置' }));
    expect(screen.getByRole('tab', { name: '项目设置' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('sdd-toggle')).toBeTruthy();
    expect(screen.getByText('SDD')).toBeTruthy();
  });

  it('reflects the SDD toggle checked state from projectSettings', () => {
    renderDialog({ projectSettings: { enabledPlugins: { 'sdd@builtin': true } } });
    fireEvent.click(screen.getByRole('tab', { name: '项目设置' }));
    expect((screen.getByTestId('sdd-toggle') as HTMLInputElement).checked).toBe(true);
  });

  it('loads project settings when the 项目设置 tab is activated', () => {
    const { onLoadProjectSettings } = renderDialog();
    fireEvent.click(screen.getByRole('tab', { name: '项目设置' }));
    expect(onLoadProjectSettings).toHaveBeenCalledTimes(1);
  });

  it('flips the SDD toggle value via onToggleBuiltinPlugin', () => {
    const { onToggleBuiltinPlugin } = renderDialog({
      projectSettings: { enabledPlugins: { 'sdd@builtin': false } },
    });
    fireEvent.click(screen.getByRole('tab', { name: '项目设置' }));
    fireEvent.click(screen.getByTestId('sdd-toggle'));
    expect(onToggleBuiltinPlugin).toHaveBeenCalledWith('sdd@builtin', true);
  });

  it('hides the save button on the 项目设置 tab (toggle persists immediately)', () => {
    renderDialog({ projectSettings: { enabledPlugins: { 'sdd@builtin': false } } });
    fireEvent.click(screen.getByRole('tab', { name: '项目设置' }));
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('keeps the save button visible on the global/model tabs', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('disables the SDD toggle while projectSettings is still loading', () => {
    renderDialog(); // no projectSettings prop
    fireEvent.click(screen.getByRole('tab', { name: '项目设置' }));
    expect((screen.getByTestId('sdd-toggle') as HTMLInputElement).disabled).toBe(true);
  });
});
