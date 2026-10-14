import { spawn } from 'node:child_process';

/** The command that opens a file in the default app on this platform. */
export function openCommand(
  file: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === 'win32') {
    // `start` is a cmd builtin; the empty "" is the window title, and the path is quoted for spaces.
    return { command: 'cmd', args: ['/c', 'start', '""', `"${file}"`] };
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [file] };
}

/** Open a file in the default browser. Resolves to an error message, or undefined on success. */
export function openInBrowser(file: string): Promise<string | undefined> {
  const { command, args } = openCommand(file);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsVerbatimArguments: process.platform === 'win32',
    });
    child.once('error', (err) => resolve(err.message));
    child.once('spawn', () => {
      child.unref();
      resolve(undefined);
    });
  });
}
