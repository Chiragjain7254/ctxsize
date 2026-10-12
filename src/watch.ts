import { type FSWatcher, watch as fsWatch } from 'node:fs';
import path from 'node:path';

// --watch: re-run the analysis when files in the repo change. Changes are debounced so a
// save that touches several files (or an editor's temp files) causes one run, and runs never
// overlap: a change that arrives during a run triggers exactly one more run afterwards.

/** Directories whose changes never matter: version control, dependencies and build output. */
export const IGNORED_DIRS: readonly string[] = ['.git', 'node_modules', 'dist'];

export type WatchFn = (
  dir: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => Pick<FSWatcher, 'close' | 'on'>;

export interface WatchOptions {
  /** Directory to watch, recursively. */
  root: string;
  /** Called once per batch of changes; errors are passed to onError and watching continues. */
  run: () => Promise<void>;
  /** Absolute paths that are ignored, e.g. the files the run itself writes. */
  ignorePaths?: readonly string[];
  /** Quiet period after the last change before running (default 300 ms). */
  debounceMs?: number;
  onError?: (err: unknown) => void;
  /** Replaces fs.watch in tests. */
  watch?: WatchFn;
}

export interface WatchHandle {
  /** Stops watching and cancels a pending run; a run already in progress finishes. */
  close(): void;
  /** Resolves once nothing is pending or running (for tests). */
  idle(): Promise<void>;
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** True when a change to this path (relative to the root, or absolute) should be ignored. */
export function isIgnored(
  root: string,
  filename: string,
  ignorePaths: readonly string[] = [],
): boolean {
  const full = path.resolve(root, filename);
  const rel = path.relative(root, full);
  if (rel.split(path.sep).some((part) => IGNORED_DIRS.includes(part))) return true;
  return ignorePaths.some((p) => samePath(path.resolve(p), full));
}

export function startWatch(opts: WatchOptions): WatchHandle {
  const debounceMs = opts.debounceMs ?? 300;
  const watchFn: WatchFn = opts.watch ?? ((dir, o, listener) => fsWatch(dir, o, listener));
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let closed = false;
  const waiters: (() => void)[] = [];

  const settle = () => {
    if (timer === undefined && running === undefined) {
      for (const w of waiters.splice(0)) w();
    }
  };

  const runNow = () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = opts
      .run()
      .catch((err) => opts.onError?.(err))
      .finally(() => {
        running = undefined;
        if (again && !closed) {
          again = false;
          schedule();
        }
        settle();
      });
  };

  const schedule = () => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      runNow();
    }, debounceMs);
  };

  const watcher = watchFn(opts.root, { recursive: true }, (_event, filename) => {
    if (filename && isIgnored(opts.root, filename.toString(), opts.ignorePaths)) return;
    schedule();
  });
  // A directory that disappears (or a platform limit) must not crash the process.
  watcher.on('error', (err) => opts.onError?.(err));

  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      watcher.close();
      settle();
    },
    idle() {
      return new Promise((resolve) => {
        waiters.push(resolve);
        settle();
      });
    },
  };
}

/** The part of Io a watch loop needs. */
export interface WatchSignals {
  /** Aborting stops the loop (tests); by default Ctrl+C (SIGINT) and SIGTERM do. */
  signal?: AbortSignal | undefined;
}

/**
 * Runs `once` now and after every batch of changes, until Ctrl+C. Resolves when stopped, so
 * the caller can exit 0 cleanly.
 */
export async function watchLoop(
  opts: Omit<WatchOptions, 'run'> & WatchSignals & { once: (rerun: boolean) => Promise<void> },
): Promise<void> {
  let first = true;
  const run = async () => {
    const rerun = !first;
    first = false;
    await opts.once(rerun);
  };
  await run().catch((err) => opts.onError?.(err));
  const handle = startWatch({ ...opts, run });
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      opts.signal?.removeEventListener('abort', stop);
      handle.close();
      resolve();
    };
    if (opts.signal) {
      if (opts.signal.aborted) return stop();
      opts.signal.addEventListener('abort', stop);
    } else {
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
  });
}
