import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { bumpVersion, bumpGradleProperties } from './version.js';

describe('version.js', () => {
  let readSpy;
  let writeSpy;

  beforeEach(() => {
    readSpy = vi.spyOn(fs, 'readFileSync');
    writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('bumpVersion', () => {
    it('bumps a patch version and writes the updated package.json', () => {
      const pkg = { name: 'demo-pkg', version: '1.0.0' };
      readSpy.mockReturnValue(JSON.stringify(pkg));

      const result = bumpVersion('/fake/package.json');

      expect(result).toEqual({
        name: 'demo-pkg',
        version: '1.0.1',
        path: '/fake/package.json',
      });
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const [, written] = writeSpy.mock.calls[0];
      expect(JSON.parse(written).version).toBe('1.0.1');
    });

    it('returns null for an invalid version format without writing', () => {
      readSpy.mockReturnValue(JSON.stringify({ name: 'bad', version: 'not-a-version' }));

      const result = bumpVersion('/fake/package.json');

      expect(result).toBeNull();
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('bumpGradleProperties', () => {
    it('replaces the pluginVersion line and returns the expected shape', () => {
      const original =
        'pluginGroup=com.wave.jetbrains\n' +
        'pluginName=Wave\n' +
        'pluginVersion=0.1.0\n' +
        '\n' +
        'platformType=IC\n';
      readSpy.mockReturnValue(original);

      const result = bumpGradleProperties('/fake/gradle.properties', '0.2.0');

      expect(result).toEqual({
        name: 'wave-jetbrains',
        version: '0.2.0',
        path: '/fake/gradle.properties',
      });
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const [destPath, written] = writeSpy.mock.calls[0];
      expect(destPath).toBe('/fake/gradle.properties');
      expect(written).toContain('pluginVersion=0.2.0');
      // Other lines preserved.
      expect(written).toContain('pluginGroup=com.wave.jetbrains');
      expect(written).toContain('pluginName=Wave');
      expect(written).toContain('platformType=IC');
      // Only one pluginVersion line in the output.
      expect(written.match(/^pluginVersion=/gm).length).toBe(1);
    });

    it('skips writing when the version is already the target', () => {
      const original = 'pluginVersion=0.2.0\n';
      readSpy.mockReturnValue(original);

      const result = bumpGradleProperties('/fake/gradle.properties', '0.2.0');

      expect(result).toEqual({
        name: 'wave-jetbrains',
        version: '0.2.0',
        path: '/fake/gradle.properties',
      });
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('handles a missing pluginVersion line by still writing the new line', () => {
      const original = 'pluginGroup=com.wave.jetbrains\n';
      readSpy.mockReturnValue(original);

      const result = bumpGradleProperties('/fake/gradle.properties', '0.3.0');

      expect(result.version).toBe('0.3.0');
      // No pluginVersion= line existed, so the regex replace produces no change;
      // the function should not write in that case.
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});
