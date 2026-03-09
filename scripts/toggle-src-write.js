import fs from 'node:fs/promises';
import path from 'node:path';

const SETTINGS_PATH = '.wave/settings.local.json';
const DENY_RULES = ['Write(**/src/**)', 'Edit(**/src/**)'];

async function toggle() {
  try {
    let settings = {};
    try {
      const content = await fs.readFile(SETTINGS_PATH, 'utf-8');
      settings = JSON.parse(content);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (!settings.permissions) {
      settings.permissions = {};
    }
    if (!settings.permissions.deny) {
      settings.permissions.deny = [];
    }

    const hasRules = DENY_RULES.every(rule => settings.permissions.deny.includes(rule));

    if (hasRules) {
      settings.permissions.deny = settings.permissions.deny.filter(rule => !DENY_RULES.includes(rule));
      if (settings.permissions.deny.length === 0) {
        delete settings.permissions.deny;
      }
      console.log('Removed deny rules for **/src/**');
    } else {
      for (const rule of DENY_RULES) {
        if (!settings.permissions.deny.includes(rule)) {
          settings.permissions.deny.push(rule);
        }
      }
      console.log('Added deny rules for **/src/**');
    }

    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error toggling deny rules:', error);
    process.exit(1);
  }
}

toggle();
