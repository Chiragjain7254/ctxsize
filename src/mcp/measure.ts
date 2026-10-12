import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { VERSION } from '../version.ts';
import type { McpServerConfig } from './config.ts';

// Starts a configured local MCP server, asks it for its tool list over stdio, and stops it.
// This RUNS the command from the repo's config, so it is only called when the user passes
// --mcp. Remote (URL) servers are never contacted.

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type McpResult =
  | { ok: true; tools: McpTool[] }
  | { ok: false; reason: 'timeout' | 'spawn-failed' | 'protocol' | 'unsupported'; message: string };

export interface MeasureOptions {
  /** Whole-run limit per server. */
  timeoutMs?: number;
  /** Where the server's working directory defaults to. */
  cwd: string;
}

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 20;
/** The parent environment a server may inherit: enough to find programs, nothing secret-shaped. */
const INHERITED_ENV = [
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
];

export function serverEnv(
  parent: Record<string, string | undefined>,
  configured: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = parent[key] ?? parent[key.toUpperCase()];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...configured };
}

export async function listTools(
  server: McpServerConfig,
  opts: MeasureOptions,
  parentEnv: Record<string, string | undefined> = process.env,
): Promise<McpResult> {
  if (server.transport !== 'stdio' || !server.command) {
    return { ok: false, reason: 'unsupported', message: 'remote servers are never contacted' };
  }
  const env = serverEnv(parentEnv, server.env);
  const cwd = server.cwd ? path.resolve(opts.cwd, server.cwd) : opts.cwd;
  const launch = resolveLaunch(server.command, server.args, env);
  if ('error' in launch) return { ok: false, reason: 'unsupported', message: launch.error };

  let child: ChildProcess;
  try {
    child = spawn(launch.file, launch.args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim,
    });
  } catch (err) {
    return { ok: false, reason: 'spawn-failed', message: (err as Error).message };
  }

  return new Promise<McpResult>((resolve) => {
    let done = false;
    let buffered = '';
    let received = 0;
    let nextId = 1;
    const tools: McpTool[] = [];
    const pending = new Map<number, (result: unknown, error?: string) => void>();
    const timer = setTimeout(
      () => finish({ ok: false, reason: 'timeout', message: 'no answer in time' }),
      opts.timeoutMs ?? 10_000,
    );

    const finish = (result: McpResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop(child);
      // Wait for the process to be gone so nothing still holds the working directory open.
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(result);
        return;
      }
      const giveUp = setTimeout(() => resolve(result), 3000);
      child.once('close', () => {
        clearTimeout(giveUp);
        resolve(result);
      });
    };
    const send = (message: object) => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        // The child may already be gone; the exit handler reports it.
      }
    };
    const request = (method: string, params: object) =>
      new Promise<unknown>((ok, fail) => {
        const id = nextId++;
        pending.set(id, (result, error) => (error ? fail(new Error(error)) : ok(result)));
        send({ jsonrpc: '2.0', id, method, params });
      });

    child.on('error', (err) => finish({ ok: false, reason: 'spawn-failed', message: err.message }));
    child.on('exit', (code) =>
      finish({ ok: false, reason: 'protocol', message: `server exited early (code ${code})` }),
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      received += chunk.length;
      if (received > MAX_OUTPUT_BYTES) {
        finish({ ok: false, reason: 'protocol', message: 'server sent too much output' });
        return;
      }
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if (typeof msg.id === 'number') {
            pending.get(msg.id)?.(
              msg.result,
              msg.error ? (msg.error.message ?? 'error') : undefined,
            );
            pending.delete(msg.id);
          }
        } catch {
          // Servers sometimes log to stdout; ignore lines that are not JSON-RPC.
        }
      }
    });

    void (async () => {
      try {
        await request('initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'ctxsize', version: VERSION },
        });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = (await request('tools/list', cursor ? { cursor } : {})) as {
            tools?: McpTool[];
            nextCursor?: string;
          };
          tools.push(...(result?.tools ?? []));
          cursor = result?.nextCursor;
          if (!cursor) break;
        }
        finish({ ok: true, tools });
      } catch (err) {
        finish({ ok: false, reason: 'protocol', message: (err as Error).message });
      }
    })();
  });
}

/** What a model is sent for one tool: its name, description and input schema. */
export function toolDefinitionText(tool: McpTool): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    input_schema: tool.inputSchema ?? { type: 'object' },
  });
}

// ---------------------------------------------------------------- launching

type Launch = { file: string; args: string[]; verbatim: boolean } | { error: string };

/**
 * Node refuses to spawn .cmd/.bat files without a shell, but `npx` is `npx.cmd` on Windows.
 * Those go through cmd.exe with strict quoting; arguments with cmd metacharacters are refused
 * rather than escaped, so a config value can never become a second command.
 */
export function resolveLaunch(
  command: string,
  args: string[],
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Launch {
  if (platform !== 'win32') return { file: command, args, verbatim: false };
  const resolved = findOnWindowsPath(command, env);
  if (!resolved || !/\.(cmd|bat)$/i.test(resolved)) {
    return { file: resolved ?? command, args, verbatim: false };
  }
  const unsafe = /[\r\n%^&|<>"`]/;
  for (const part of [resolved, ...args]) {
    if (unsafe.test(part)) {
      return { error: `argument has characters ctxsize will not pass through cmd.exe: ${part}` };
    }
  }
  const quote = (s: string) => (/[\s()!,;=]/.test(s) || s === '' ? `"${s}"` : s);
  const line = [resolved, ...args].map(quote).join(' ');
  return { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

function findOnWindowsPath(command: string, env: Record<string, string>): string | undefined {
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs =
    path.isAbsolute(command) || /[\\/]/.test(command) ? [''] : (env.PATH ?? '').split(';');
  for (const dir of dirs) {
    const base = dir ? path.join(dir, command) : command;
    for (const ext of ['', ...exts]) {
      const candidate = base + ext;
      if (existsSync(candidate) && path.extname(candidate) !== '') return candidate;
    }
  }
  return undefined;
}

function stop(child: ChildProcess): void {
  try {
    child.stdin?.end();
  } catch {
    // Already closed.
  }
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    // Kills the whole tree: npx starts the real server as a grandchild.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGKILL');
  }
}
