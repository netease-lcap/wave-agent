import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';

export interface CliOptions {
  workdir: string;
  ignore?: string[];
}

export async function startCli(options: CliOptions): Promise<void> {
  const { workdir, ignore } = options;

  // Render the application
  render(<App workdir={workdir} ignore={ignore} />);

  // Return a promise that never resolves to keep the CLI running
  return new Promise(() => {});
}
