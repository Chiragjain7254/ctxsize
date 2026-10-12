import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
import { isIgnored, startWatch, type WatchFn } from '../src/watch.ts';
import { tmpRepo } from './helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await sleep(20);
  }
}

/** A stand-in for fs.watch: call emit(name) to simulate a change. */
function fakeWatch() {
  let listener: (event: string, filename: string | null) => void = () => {};
  let closed = false;
  const watch: WatchFn = (_dir, _opts, l) => {
    listener = l;
    return {
      close: () => {
        closed = true;
      },
      on() {
        return this as never;
      },
    };
  };
  return { watch, emit: (name: string | null) => listener('change', name), isClosed: () => closed };
}

describe('isIgnored', () => {
  const root = path.resolve('/repo');
  test('ignores .git, node_modules and dist at any depth', () => {
    expect(isIgnored(root, path.join('.git', 'index'))).toBe(true);
    expect(isIgnored(root, path.join('pkg', 'node_modules', 'x', 'a.md'))).toBe(true);
    expect(isIgnored(root, path.join('dist', 'cli.mjs'))).toBe(true);
    expect(isIgnored(root, 'AGENTS.md')).toBe(false);
    expect(isIgnored(root, path.join('src', 'distinct', 'AGENTS.md'))).toBe(false);
  });
  test('ignores the files the run writes', () => {
    const out = path.join(root, 'ctxsize-report.html');
    expect(isIgnored(root, 'ctxsize-report.html', [out])).toBe(true);
    expect(isIgnored(root, 'other.html', [out])).toBe(false);
  });
});

describe('startWatch', () => {
  test('debounces a burst of changes into one run', async () => {
    const fake = fakeWatch();
    let runs = 0;
    const h = startWatch({
      root: '/repo',
      debounceMs: 30,
      watch: fake.watch,
      run: async () => {
        runs++;
      },
    });
    for (const name of ['a.md', 'b.md', 'c.md']) fake.emit(name);
    await h.idle();
    expect(runs).toBe(1);
    h.close();
  });

  test('ignored paths do not trigger a run', async () => {
    const fake = fakeWatch();
    let runs = 0;
    const h = startWatch({
      root: path.resolve('/repo'),
      debounceMs: 10,
      watch: fake.watch,
      run: async () => {
        runs++;
      },
    });
    fake.emit(path.join('.git', 'HEAD'));
    fake.emit(path.join('node_modules', 'x', 'y.js'));
    await sleep(60);
    expect(runs).toBe(0);
    h.close();
  });

  test('a change during a run causes exactly one more run, never an overlap', async () => {
    const fake = fakeWatch();
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const h = startWatch({
      root: '/repo',
      debounceMs: 10,
      watch: fake.watch,
      run: async () => {
        runs++;
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(60);
        active--;
      },
    });
    fake.emit('a.md');
    await sleep(30); // the run has started
    fake.emit('b.md');
    fake.emit('c.md');
    await sleep(200);
    await h.idle();
    expect(runs).toBe(2);
    expect(maxActive).toBe(1);
    h.close();
  });

  test('a failing run is reported and watching continues', async () => {
    const fake = fakeWatch();
    const errors: unknown[] = [];
    let runs = 0;
    const h = startWatch({
      root: '/repo',
      debounceMs: 10,
      watch: fake.watch,
      onError: (e) => errors.push(e),
      run: async () => {
        runs++;
        if (runs === 1) throw new Error('boom');
      },
    });
    fake.emit('a.md');
    await h.idle();
    fake.emit('a.md');
    await h.idle();
    expect(errors).toHaveLength(1);
    expect(runs).toBe(2);
    h.close();
  });

  test('close stops the watcher and cancels a pending run', async () => {
    const fake = fakeWatch();
    let runs = 0;
    const h = startWatch({
      root: '/repo',
      debounceMs: 50,
      watch: fake.watch,
      run: async () => {
        runs++;
      },
    });
    fake.emit('a.md');
    h.close();
    await sleep(120);
    expect(runs).toBe(0);
    expect(fake.isClosed()).toBe(true);
  });

  test('sees a real file change in a temp repo', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': 'one\n' });
    let runs = 0;
    const h = startWatch({
      root: dir,
      debounceMs: 30,
      run: async () => {
        runs++;
      },
    });
    await sleep(100); // let the OS watcher settle
    writeFileSync(path.join(dir, 'AGENTS.md'), 'two\n');
    await until(() => runs >= 1);
    h.close();
    expect(runs).toBeGreaterThanOrEqual(1);
  });
});

describe('ctxsize --watch', () => {
  function io(cwd: string, signal: AbortSignal) {
    const out = { stdout: '', stderr: '' };
    return {
      out,
      io: {
        stdout: (t: string) => {
          out.stdout += t;
        },
        stderr: (t: string) => {
          out.stderr += t;
        },
        env: {},
        isTTY: false,
        cwd,
        signal,
      },
    };
  }

  test('re-runs after a change, writes the data file only in watch mode, and exits 0 on stop', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': 'Use npm.\n' });
    const ac = new AbortController();
    const { io: env, out } = io(dir, ac.signal);
    const html = path.join(dir, 'r.html');
    const finished = run(['--watch', '--html', '--out', html, '--agents', 'codex'], env);

    await until(() => out.stderr.includes('updated'));
    await sleep(150); // the OS watcher is up
    expect(existsSync(html)).toBe(true);
    const dataFile = path.join(dir, 'r.data.js');
    expect(readFileSync(dataFile, 'utf8')).toMatch(/^window\.__ctxsizeData = \{/);
    const before = readFileSync(dataFile, 'utf8');
    const reports = out.stderr.split('updated').length - 1;

    writeFileSync(path.join(dir, 'AGENTS.md'), `Use npm. ${'More words here. '.repeat(50)}\n`);
    await until(() => out.stderr.split('updated').length - 1 > reports);
    expect(readFileSync(dataFile, 'utf8')).not.toBe(before);
    expect(readFileSync(html, 'utf8')).toContain('"file":"r.data.js"');

    // Writing its own output must not trigger another run.
    const settled = out.stderr.split('updated').length - 1;
    await sleep(800);
    expect(out.stderr.split('updated').length - 1).toBe(settled);

    ac.abort();
    expect(await finished).toBe(EXIT.ok);
  }, 20000);

  test('without --html nothing is written and no data file appears', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': 'Use npm.\n' });
    const ac = new AbortController();
    const { io: env, out } = io(dir, ac.signal);
    const finished = run(['--watch', '--agents', 'codex'], env);
    await until(() => out.stderr.includes('updated'));
    ac.abort();
    expect(await finished).toBe(EXIT.ok);
    expect(out.stdout).toContain('Codex');
    expect(existsSync(path.join(dir, 'ctxsize-report.data.js'))).toBe(false);
  });

  test('a plain --html run writes no data file', async () => {
    const dir = tmpRepo({ '.git/': '', 'AGENTS.md': 'Use npm.\n' });
    const { io: env } = io(dir, new AbortController().signal);
    const html = path.join(dir, 'r.html');
    expect(await run(['--html', '--out', html, '--agents', 'codex'], env)).toBe(EXIT.ok);
    expect(existsSync(html)).toBe(true);
    expect(existsSync(path.join(dir, 'r.data.js'))).toBe(false);
  });

  test('--watch with --max-tokens is a usage error', async () => {
    const dir = tmpRepo({ '.git/': '' });
    const { io: env, out } = io(dir, new AbortController().signal);
    expect(await run(['--watch', '--max-tokens', '10'], env)).toBe(EXIT.usage);
    expect(out.stderr).toContain('--watch');
  });
});
