import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SlashCommandsPopup } from '../../src/components/SlashCommandsPopup';

// Component imports its CSS directly; stub it so jsdom doesn't need to parse styles.
vi.mock('../../src/styles/SlashCommandsPopup.css', () => ({}));

type Command = { id: string; name: string; description: string };

function renderPopup(commands: Command[], selectedIndex = 0) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const utils = render(
        <SlashCommandsPopup
            commands={commands}
            isVisible={true}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onClose={onClose}
            position={{ top: 0, left: 0 }}
        />
    );
    return { ...utils, onSelect, onClose };
}

// Return the group container (.slash-group) whose title matches `title`.
function getGroup(title: string): HTMLElement {
    const titleEl = screen.getByText(title, { selector: '.slash-group-title' });
    const group = titleEl.closest('.slash-group');
    expect(group).not.toBeNull();
    return group as HTMLElement;
}

describe('SlashCommandsPopup grouping', () => {
    it('renders all three group titles and assigns commands to the correct group', () => {
        const commands: Command[] = [
            { id: 'plugin', name: 'plugin', description: '插件管理' },
            { id: 'config', name: 'config', description: '配置' },
            { id: 'mcp', name: 'mcp', description: 'MCP' },
            { id: 'status', name: 'status', description: '状态' },
            { id: 'clear', name: 'clear', description: '清空' },
            { id: 'settings', name: 'settings', description: '设置技能' },
            { id: 'loop', name: 'loop', description: '循环技能' },
            { id: 'deepwiki:ask', name: 'deepwiki:ask', description: 'DeepWiki' }
        ];

        renderPopup(commands);

        // All three group titles are present.
        expect(screen.getByText('插件管理', { selector: '.slash-group-title' })).toBeInTheDocument();
        expect(screen.getByText('系统指令', { selector: '.slash-group-title' })).toBeInTheDocument();
        expect(screen.getByText('技能', { selector: '.slash-group-title' })).toBeInTheDocument();

        // plugin -> 插件管理
        const pluginGroup = getGroup('插件管理');
        expect(within(pluginGroup).getByTestId('slash-command-plugin')).toBeInTheDocument();
        expect(within(pluginGroup).queryByTestId('slash-command-config')).not.toBeInTheDocument();

        // config/mcp/status/clear -> 系统指令
        const systemGroup = getGroup('系统指令');
        for (const id of ['config', 'mcp', 'status', 'clear']) {
            expect(within(systemGroup).getByTestId(`slash-command-${id}`)).toBeInTheDocument();
        }
        expect(within(systemGroup).queryByTestId('slash-command-plugin')).not.toBeInTheDocument();
        expect(within(systemGroup).queryByTestId('slash-command-settings')).not.toBeInTheDocument();

        // everything else -> 技能
        const skillGroup = getGroup('技能');
        for (const id of ['settings', 'loop', 'deepwiki:ask']) {
            expect(within(skillGroup).getByTestId(`slash-command-${id}`)).toBeInTheDocument();
        }
        expect(within(skillGroup).queryByTestId('slash-command-config')).not.toBeInTheDocument();
    });

    it('renders groups in a fixed order: 插件管理 -> 系统指令 -> 技能', () => {
        const commands: Command[] = [
            { id: 'settings', name: 'settings', description: '设置技能' },
            { id: 'config', name: 'config', description: '配置' },
            { id: 'plugin', name: 'plugin', description: '插件管理' }
        ];

        const { container } = renderPopup(commands);

        const titles = Array.from(
            container.querySelectorAll('.slash-group-title')
        ).map((el) => el.textContent);
        expect(titles).toEqual(['插件管理', '系统指令', '技能']);
    });

    it('does not render empty group titles when only SDK/skill commands are present', () => {
        const commands: Command[] = [
            { id: 'settings', name: 'settings', description: '设置技能' },
            { id: 'loop', name: 'loop', description: '循环技能' },
            { id: 'deepwiki:ask', name: 'deepwiki:ask', description: 'DeepWiki' }
        ];

        renderPopup(commands);

        expect(screen.queryByText('插件管理', { selector: '.slash-group-title' })).not.toBeInTheDocument();
        expect(screen.queryByText('系统指令', { selector: '.slash-group-title' })).not.toBeInTheDocument();
        expect(screen.getByText('技能', { selector: '.slash-group-title' })).toBeInTheDocument();
    });

    it('applies .selected to the item at the flat selectedIndex, including across groups', () => {
        // Flat order: 0 plugin(插件管理), 1 config(系统指令), 2 mcp(系统指令),
        //             3 settings(技能), 4 loop(技能)
        const commands: Command[] = [
            { id: 'plugin', name: 'plugin', description: '插件管理' },
            { id: 'config', name: 'config', description: '配置' },
            { id: 'mcp', name: 'mcp', description: 'MCP' },
            { id: 'settings', name: 'settings', description: '设置技能' },
            { id: 'loop', name: 'loop', description: '循环技能' }
        ];

        const { container } = renderPopup(commands, 3);

        const selected = container.querySelectorAll('.slash-command-item.selected');
        // Exactly one selected item, and it is the 4th command (settings) in the flat array.
        expect(selected).toHaveLength(1);
        expect(selected[0]).toBe(screen.getByTestId('slash-command-settings'));
    });

    it('marks the correct item when selectedIndex points into the first group', () => {
        const commands: Command[] = [
            { id: 'plugin', name: 'plugin', description: '插件管理' },
            { id: 'config', name: 'config', description: '配置' },
            { id: 'settings', name: 'settings', description: '设置技能' }
        ];

        renderPopup(commands, 0);

        expect(screen.getByTestId('slash-command-plugin')).toHaveClass('selected');
        expect(screen.getByTestId('slash-command-config')).not.toHaveClass('selected');
        expect(screen.getByTestId('slash-command-settings')).not.toHaveClass('selected');
    });

    it('renders the command name with a leading slash and its description', () => {
        const commands: Command[] = [
            { id: 'settings', name: 'settings', description: '打开设置' }
        ];

        renderPopup(commands);

        const item = screen.getByTestId('slash-command-settings');
        expect(within(item).getByText('/settings', { selector: '.slash-command-name' })).toBeInTheDocument();
        expect(within(item).getByText('打开设置', { selector: '.slash-command-description' })).toBeInTheDocument();
    });
});
