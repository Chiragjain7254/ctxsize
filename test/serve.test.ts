import { writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
import { renderPage, startReportServer } from '../src/serve.ts';
import { tmpRepo } from './helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(check: () => T | undefined | false, ms = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error('timed out');
    await sleep(20);
  }
}

const repo = () => tmpRepo({ '.git/': '', 'AGENTS.md': '# Agents\nBe brief.\n' });

interface Running {
  url: string;
  stderr: () => string;
  opened: string[];
  stop: () => Promise<number>;
}

/** Runs `ctxsize --serve` in-process with a mock browser opener, until stop() is called. */
async function serve(argv: string[], dir: string): Promise<Running> {
  const abort = new AbortController();
  let stderr = '';
  const opened: string[] = [];
  const done = run(['--serve', ...argv, dir], {
    stdout: () => {},
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: false,
    cwd: dir,
    signal: abort.signal,
    open: async (target) => {
      opened.push(target);
      return undefined;
    },
  });
  const url = await until(
    () => /running at (http:\/\/localhost:\d+) — press Ctrl\+C/.exec(stderr)?.[1],
  );
  return {
    url,
    stderr: () => stderr,
    opened,
    stop: async () => {
      abort.abort();
      return done;
    },
  };
}

describe('--serve', () => {
  test('GET / returns the HTML report and /api/report the JSON', async () => {
    const s = await serve(['--no-open', '--port', '0'], repo());
    try {
      const page = await fetch(s.url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      const html = await page.text();
      expect(html).toContain('What each agent loads before your first prompt');
      expect(html).toContain('"stream":"/events"');

      const api = await fetch(`${s.url}/api/report`);
      expect(api.status).toBe(200);
      expect(api.headers.get('content-type')).toContain('application/json');
      const report = await api.json();
      expect(report.schemaVersion).toBe(2);
      expect(report.agents.map((a: { agent: string }) => a.agent)).toContain('codex');
      expect(report.hidden).toContain('aider');

      expect((await fetch(`${s.url}/nope`)).status).toBe(404);
    } finally {
      expect(await s.stop()).toBe(EXIT.ok);
    }
  });

  test('the usual flags work with it', async () => {
    const s = await serve(['--no-open', '--port', '0', '--agents', 'codex,aider', '--all'], repo());
    try {
      const report = await (await fetch(`${s.url}/api/report`)).json();
      expect(report.agents.map((a: { agent: string }) => a.agent)).toEqual(['codex', 'aider']);
      expect(report.hidden).toEqual([]);
    } finally {
      await s.stop();
    }
  });

  test('opens the browser by default and not with --no-open', async () => {
    const a = await serve(['--port', '0'], repo());
    try {
      expect(a.opened).toEqual([a.url]);
    } finally {
      await a.stop();
    }
    const b = await serve(['--no-open', '--port', '0'], repo());
    try {
      expect(b.opened).toEqual([]);
    } finally {
      await b.stop();
    }
  });

  test('a failed browser launch is only a warning', async () => {
    const dir = repo();
    const abort = new AbortController();
    let stderr = '';
    const done = run(['--serve', '--port', '0', dir], {
      stdout: () => {},
      stderr: (t) => {
        stderr += t;
      },
      env: {},
      isTTY: false,
      cwd: dir,
      signal: abort.signal,
      open: async () => 'spawn xdg-open ENOENT',
    });
    await until(() => stderr.includes('could not open the browser: spawn xdg-open ENOENT'));
    abort.abort();
    expect(await done).toBe(EXIT.ok);
  });

  test('pushes an update over Server-Sent Events when a file changes', async () => {
    const dir = repo();
    const s = await serve(['--no-open', '--port', '0'], dir);
    const res = await fetch(`${s.url}/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let seen = '';
    const events = () => seen.split('\n\n').filter((e) => e.startsWith('data: '));
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        seen += decoder.decode(value);
      }
    })();
    try {
      await until(() => events().length >= 1);
      const first = JSON.parse((events()[0] ?? '').slice(6));
      expect(first.stream).toBe('/events');
      writeFileSync(path.join(dir, 'AGENTS.md'), `# Agents\n${'More words here. '.repeat(200)}\n`);
      await until(() => events().length >= 2);
      const last = JSON.parse((events().at(-1) ?? '').slice(6));
      expect(last.generated).not.toBe(first.generated);
      const codex = (e: typeof first) => e.agents.find((a: { id: string }) => a.id === 'codex');
      expect(codex(last).items[0].o).toBeGreaterThan(codex(first).items[0].o);
    } finally {
      await reader.cancel();
      await pump.catch(() => {});
      expect(await s.stop()).toBe(EXIT.ok);
    }
  }, 15000);
});

describe('startReportServer', () => {
  test('binds to 127.0.0.1 only', async () => {
    const server = await startReportServer({ port: 0 });
    try {
      expect(server.host).toBe('127.0.0.1');
      const probe = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(server.port, '127.0.0.1', () => {
          resolve(socket.remoteAddress ?? '');
          socket.destroy();
        });
        socket.on('error', reject);
      });
      expect(probe).toBe('127.0.0.1');
      expect(server.url).toBe(`http://localhost:${server.port}`);
    } finally {
      await server.close();
    }
  });

  test('moves to the next port when the first is taken', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as net.AddressInfo).port;
    let server: Awaited<ReturnType<typeof startReportServer>> | undefined;
    try {
      server = await startReportServer({ port: taken });
      expect(server.port).toBeGreaterThan(taken);
      expect(server.port).toBeLessThan(taken + 10);
    } finally {
      await server?.close();
      await new Promise((r) => blocker.close(r));
    }
  });

  test('gives up when no port in the allowed range is free', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as net.AddressInfo).port;
    try {
      await expect(startReportServer({ port: taken, tries: 1 })).rejects.toThrow();
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  test('refuses a request whose Host is not this machine', async () => {
    const server = await startReportServer({ port: 0 });
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: server.port, path: '/', headers: { host: 'evil.example' } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(403);
    } finally {
      await server.close();
    }
  });

  test('answers 503 until the first report arrives, then serves it', async () => {
    const server = await startReportServer({ port: 0 });
    try {
      expect((await fetch(server.url)).status).toBe(503);
      server.update({ html: '<p>hi</p>', json: '{"a":1}\n', event: '{}' });
      expect(await (await fetch(server.url)).text()).toBe('<p>hi</p>');
      expect(await (await fetch(`${server.url}/api/report`)).json()).toEqual({ a: 1 });
    } finally {
      await server.close();
    }
  });
});

describe('renderPage', () => {
  test('--serve pages carry the event stream url', async () => {
    const dir = repo();
    let json = '';
    await run(['--json', dir], {
      stdout: (t) => {
        json += t;
      },
      stderr: () => {},
      env: {},
      isTTY: false,
      cwd: dir,
    });
    expect(JSON.parse(json).schemaVersion).toBe(2);
    const { analyze } = await import('../src/core/analyze.ts');
    const { buildTools } = await import('../src/tools.ts');
    const { allModels } = await import('../src/models.ts');
    const tools = buildTools();
    const models = allModels();
    const report = await analyze({
      cwd: dir,
      root: dir,
      agents: tools.map((t) => t.id),
      tools,
      env: {},
      models: { models, choice: { perTool: {} } },
    });
    const page = await renderPage(report, models);
    expect(JSON.parse(page.event).stream).toBe('/events');
    expect(page.html).toContain('"stream":"/events"');
  });
});

describe('flag checks', () => {
  const bad = async (argv: string[]) => {
    const dir = repo();
    let stderr = '';
    const code = await run([...argv, dir], {
      stdout: () => {},
      stderr: (t) => {
        stderr += t;
      },
      env: {},
      isTTY: false,
      cwd: dir,
    });
    return { code, stderr };
  };

  test.each([
    [['--port', '5000'], '--port needs --serve'],
    [['--no-open'], '--no-open needs --serve'],
    [['--serve', '--json'], '--serve cannot be combined with --json'],
    [['--serve', '--html'], '--serve cannot be combined with --html'],
    [['--serve', '--mcp'], '--serve cannot be combined with --mcp'],
    [['--serve', '--open', '--no-open'], 'use --open or --no-open, not both'],
    [['--serve', '--port', '70000'], '--port must be a whole number from 0 to 65535'],
  ])('%j is a usage error', async (argv, message) => {
    const r = await bad(argv);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain(message);
  });
});
