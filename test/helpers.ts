import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes a throwaway repo. Keys are POSIX paths; a trailing "/" makes an empty dir.
 * A ".git/" key marks the repo root. Removed after each test.
 */
export function tmpRepo(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ctxsize-')));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    if (rel.endsWith('/')) {
      mkdirSync(full, { recursive: true });
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  return dir;
}

/** A fake home directory; never the real one. */
export function fakeHome(files: Record<string, string> = {}): string {
  const home = tmpRepo(files);
  if (home === os.homedir()) throw new Error('fakeHome must not be the real home');
  return home;
}

export function fixturePath(...parts: string[]): string {
  return path.join(import.meta.dirname, 'fixtures', ...parts);
}
