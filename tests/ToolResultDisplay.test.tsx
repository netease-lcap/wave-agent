import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolResultDisplay } from '../src/components/ToolResultDisplay';
import type { ToolBlock } from '../src/types';

// Mock toolRegistry - no longer needed since we removed display fields
vi.mock('../src/plugins/tools', () => ({
  toolRegistry: {},
}));

describe('ToolResultDisplay Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Collapsed view display', () => {
    it('should display shortResult when available', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'read_file',
          success: true,
        },
        parameters: JSON.stringify({
          target_file: 'src/test.ts',
          explanation: 'Testing file reading',
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 50,
        }),
        result: 'File content here...',
        shortResult: 'Read 50 lines from src/test.ts',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show tool name and status
      expect(output).toContain('🔧 read_file');
      expect(output).toContain('✅ Success');

      // Should show shortResult
      expect(output).toContain('Result:');
      expect(output).toContain('Read 50 lines from src/test.ts');

      // Should show parameter preview (first 200 chars)
      expect(output).toContain('Parameters:');
      expect(output).toContain('target_file');
    });

    it('should display parameter preview when shortResult is not available', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'read_file',
          success: true,
        },
        parameters: JSON.stringify({
          target_file: 'src/test.ts',
          explanation: 'Testing file reading',
        }),
        result: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show parameter preview
      expect(output).toContain('Parameters:');
      expect(output).toContain('target_file');
      expect(output).toContain('explanation');

      // Should show last 5 lines from result as fallback for shortResult
      expect(output).toContain('Result:');
      expect(output).toContain('Line 3');
      expect(output).toContain('Line 4');
      expect(output).toContain('Line 5');
      expect(output).toContain('Line 6');
      expect(output).toContain('Line 7');
    });

    it('should not show shortResult indicator when both shortResult and result are not available', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'read_file',
          success: true,
        },
        parameters: JSON.stringify({
          target_file: 'src/test.ts',
          explanation: 'Testing file reading',
        }),
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show parameter preview
      expect(output).toContain('Parameters:');
      expect(output).toContain('target_file');
      expect(output).toContain('explanation');

      // Should not show shortResult indicator when neither shortResult nor result is available
      expect(output).not.toContain('Result:');
    });

    it('should handle long parameter content by truncating to 200 characters', () => {
      const longContent = {
        param1: 'a'.repeat(100),
        param2: 'b'.repeat(100),
        param3: 'c'.repeat(100),
      };

      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'some_tool',
          success: true,
        },
        parameters: JSON.stringify(longContent),
        result: 'Some result...',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show parameter preview
      expect(output).toContain('Parameters:');

      // Should truncate long content
      const parametersSection = output?.substring(output.indexOf('Parameters:')) || '';
      const ellipsisIndex = parametersSection.indexOf('...');
      if (ellipsisIndex !== -1) {
        const truncatedPart = parametersSection.substring(0, ellipsisIndex + 3);
        expect(truncatedPart.length).toBeLessThanOrEqual(250); // 200 chars + some buffer for formatting
      }
    });

    it('should show both shortResult and parameter preview when both are available', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'some_tool',
          success: true,
        },
        parameters: JSON.stringify({
          param1: 'value1',
        }),
        result: 'Some result...',
        shortResult: 'Operation completed successfully',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show both shortResult and parameter preview
      expect(output).toContain('Result:');
      expect(output).toContain('Operation completed successfully');
      expect(output).toContain('Parameters:');
      expect(output).toContain('param1');

      // Parameters should appear before shortResult (as input parameters come first)
      const parametersIndex = output?.indexOf('Parameters:') || -1;
      const shortResultIndex = output?.indexOf('Result:') || -1;
      expect(parametersIndex).toBeLessThan(shortResultIndex);
    });
  });

  describe('Tool status display', () => {
    it('should show success status', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'test_tool',
          success: true,
        },
        parameters: '{}',
        result: 'Success',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain('✅ Success');
    });

    it('should show error status with message', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'test_tool',
          success: false,
          error: 'File not found',
        },
        parameters: '{}',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain('❌ Failed');
      expect(output).toContain('Error: File not found');
    });

    it('should show running status', () => {
      const toolBlock: ToolBlock = {
        type: 'tool',
        attributes: {
          name: 'test_tool',
          isRunning: true,
        },
        parameters: '{}',
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain('🔄 Running...');
    });
  });
});
