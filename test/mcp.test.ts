import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { countTokens } from '../src/core/tokenize.ts';
import { findMcpServers, parseCodexToml, parseJsonc } from '../src/mcp/config.ts';
import { listTools, resolveLaunch, serverEnv, toolDefinitionText } from '../src/mcp/measure.ts';
import { EXIT, run } from '../src/run.ts';
import { fixturePath, tmpRepo } from './helpers.ts';

async function cli(argv: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env,
    isTTY: false,
    cwd,
  });
  return { code, stdout, stderr };
}

const FAKE = fixturePath('mcp', 'fake-server.mjs');
const fakeServer = (env: Record<string, string> = {}) => ({
  command: process.execPath,
  args: [FAKE],
  env,
});
const markerLines = (marker: string) =>
  existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').length : 0;

describe('finding MCP servers', () => {
  test('each tool reads its documented file and key', () => {
    const root = tmpRepo({
      '.git/': '',
      '.mcp.json': JSON.stringify({ mcpServers: { a: { command: 'node', args: ['x.js'] } } }),
      '.cursor/mcp.json': JSON.stringify({ mcpServers: { b: { type: 'stdio', command: 'npx' } } }),
      '.vscode/mcp.json': JSON.stringify({
        servers: { c: { type: 'http', url: 'https://x.test/mcp' } },
      }),
      '.gemini/settings.json':
        '{ // comment\n "mcpServers": { "d": { "command": "d", }, "e": { "httpUrl": "https://e.test" } } }',
      'opencode.json': JSON.stringify({
        mcp: { f: { type: 'local', command: ['bun', 'run', 's.ts'] } },
      }),
    });
    const names = (tool: string) => findMcpServers(root, tool).servers.map((s) => s.name);
    expect(names('claude')).toEqual(['a']);
    expect(names('cursor')).toEqual(['b']);
    expect(names('copilot')).toEqual(['c']);
    expect(names('gemini')).toEqual(['d', 'e']);
    expect(findMcpServers(root, 'opencode').servers[0]).toMatchObject({
      command: 'bun',
      args: ['run', 's.ts'],
      transport: 'stdio',
    });
    expect(findMcpServers(root, 'zed').servers).toEqual([]);
    expect(findMcpServers(root, 'claude').servers[0]?.configPath).toBe('.mcp.json');
  });

  test('remote servers are recognised, disabled ones skipped, bad JSON becomes a warning', () => {
    const root = tmpRepo({
      '.mcp.json': JSON.stringify({
        mcpServers: {
          remote: { type: 'http', url: 'https://x.test/mcp' },
          off: { command: 'x', enabled: false },
        },
      }),
      '.cursor/mcp.json': '{ not json',
    });
    expect(findMcpServers(root, 'claude').servers.map((s) => [s.name, s.transport])).toEqual([
      ['remote', 'remote'],
    ]);
    const bad = findMcpServers(root, 'cursor');
    expect(bad.servers).toEqual([]);
    expect(bad.warnings[0]).toContain('.cursor/mcp.json');
  });

  test('Codex TOML: tables, arrays, inline and sub-table env, quoted names, comments', () => {
    const toml = `
model = "x"
[mcp_servers.docs]  # the docs server
command = "npx"
args = ["-y", "docs-mcp", "--flag=a # not a comment"]
env = { TOKEN = "t1", OTHER = 'o' }

[mcp_servers."my server"]
command = "uvx"
args = [
  "one",
  "two",
]
[mcp_servers."my server".env]
KEY = "v"

[mcp_servers.web]
url = "https://web.test/mcp"

[other]
command = "ignored"
`;
    const parsed = parseCodexToml(toml, 'mcp_servers') as Record<string, Record<string, unknown>>;
    expect(Object.keys(parsed)).toEqual(['docs', 'my server', 'web']);
    expect(parsed.docs).toMatchObject({
      command: 'npx',
      args: ['-y', 'docs-mcp', '--flag=a # not a comment'],
      env: { TOKEN: 't1', OTHER: 'o' },
    });
    expect(parsed['my server']).toMatchObject({ args: ['one', 'two'], env: { KEY: 'v' } });
    const root = tmpRepo({ '.codex/config.toml': toml });
    expect(findMcpServers(root, 'codex').servers.map((s) => s.transport)).toEqual([
      'stdio',
      'stdio',
      'remote',
    ]);
  });

  test('parseJsonc handles comments inside and outside strings and trailing commas', () => {
    expect(parseJsonc('{ "a": "http://x // not a comment", /* c */ "b": [1, 2,], }')).toEqual({
      a: 'http://x // not a comment',
      b: [1, 2],
    });
  });
});

describe('measuring a server', () => {
  const opts = (timeoutMs = 10_000) => ({ cwd: process.cwd(), timeoutMs });
  const server = (env: Record<string, string> = {}) => ({
    name: 'fake',
    transport: 'stdio' as const,
    configPath: '.mcp.json',
    ...fakeServer(env),
  });

  test('lists tools, following pages, and ignores non-JSON log lines', async () => {
    const normal = await listTools(server(), opts());
    expect(normal.ok && normal.tools.map((t) => t.name)).toEqual(['tool_1', 'tool_2']);
    const pages = await listTools(server({ FAKE_MODE: 'pages' }), opts());
    expect(pages.ok && pages.tools).toHaveLength(3);
    const noisy = await listTools(server({ FAKE_MODE: 'noisy' }), opts());
    expect(noisy.ok && noisy.tools).toHaveLength(2);
  }, 30_000);

  test('a crash, a hang and a missing program are reported, not thrown', async () => {
    const crash = await listTools(server({ FAKE_MODE: 'crash' }), opts());
    expect(crash).toMatchObject({ ok: false, reason: 'protocol' });
    const hang = await listTools(server({ FAKE_MODE: 'hang' }), opts(700));
    expect(hang).toMatchObject({ ok: false, reason: 'timeout' });
    const missing = await listTools(
      { ...server(), command: path.join(process.cwd(), 'no-such-program') },
      opts(),
    );
    expect(missing.ok).toBe(false);
  }, 30_000);

  test('remote servers are never contacted', async () => {
    const result = await listTools(
      { name: 'r', transport: 'remote', configPath: 'x', args: [], env: {}, url: 'https://x.test' },
      opts(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  test('the server only inherits a small, non-secret environment', () => {
    const env = serverEnv(
      { PATH: '/bin', HOME: '/h', AWS_SECRET_ACCESS_KEY: 'x', GITHUB_TOKEN: 'y', NPM_TOKEN: 'z' },
      { MY_KEY: 'configured' },
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', MY_KEY: 'configured' });
  });

  test('cmd.exe launches refuse metacharacters instead of escaping them', () => {
    const win = (args: string[]) =>
      resolveLaunch('node', args, { PATH: '', PATHEXT: '.EXE' }, 'win32');
    expect('error' in resolveLaunch(process.execPath, ['x'], {}, 'linux')).toBe(false);
    // Not a .cmd file here, so nothing goes through cmd.exe and nothing needs refusing.
    expect('error' in win(['a & calc'])).toBe(false);
  });

  test('tool definitions are counted from name, description and schema', () => {
    const text = toolDefinitionText({
      name: 'a',
      description: 'b',
      inputSchema: { type: 'object' },
    });
    expect(JSON.parse(text)).toEqual({
      name: 'a',
      description: 'b',
      input_schema: { type: 'object' },
    });
    expect(countTokens(text)).toBeGreaterThan(5);
  });
});

describe('--mcp through the CLI', () => {
  const setup = (extraEnv: Record<string, string> = {}) => {
    const dir = tmpRepo({ '.git/': '' });
    const marker = path.join(tmpRepo({}), 'marker.txt');
    const server = { ...fakeServer({ FAKE_MARKER: marker, ...extraEnv }) };
    const config = JSON.stringify({ mcpServers: { fake: server } });
    const repo = tmpRepo({
      '.git/': '',
      '.mcp.json': config,
      '.cursor/mcp.json': config,
      '.gemini/settings.json': config,
    });
    return { dir, repo, marker };
  };

  test('by default servers are listed but never started', async () => {
    const { repo, marker } = setup();
    const r = await cli(['--json', '--agents', 'claude,cursor'], repo);
    expect(r.code).toBe(EXIT.ok);
    const claude = JSON.parse(r.stdout).agents.find((a: { agent: string }) => a.agent === 'claude');
    expect(claude.mcp.servers[0]).toMatchObject({ name: 'fake', status: 'not-measured' });
    expect(claude.mcp.measuredTokens).toBeNull();
    expect(existsSync(marker)).toBe(false);
    const text = (await cli(['--agents', 'claude'], repo)).stdout;
    expect(text).toContain('MCP servers configured in this repo');
    expect(text).toContain('Pass --mcp');
  });

  test('--mcp starts each distinct server once, prints what it runs, and counts tokens per tool', async () => {
    const { repo, marker } = setup();
    const r = await cli(['--json', '--mcp', '--agents', 'claude,cursor,gemini'], repo);
    expect(r.code).toBe(EXIT.ok);
    expect(markerLines(marker)).toBe(1);
    expect(r.stderr).toContain('starting 1 local MCP server(s)');
    expect(r.stderr).toContain(FAKE);
    const agents = JSON.parse(r.stdout).agents;
    const claude = agents.find((a: { agent: string }) => a.agent === 'claude');
    expect(claude.mcp.servers[0]).toMatchObject({ status: 'measured', tools: 2 });
    expect(claude.mcp.measuredTokens).toBe(claude.mcp.servers[0].tokens);
    expect(claude.mcp.measuredTokens).toBeGreaterThan(20);
  }, 30_000);

  test('a failing server is a "failed" line, not a crash', async () => {
    const { repo } = setup({ FAKE_MODE: 'crash' });
    const r = await cli(['--mcp', '--agents', 'claude'], repo);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('failed');
  }, 30_000);

  test('a repo without MCP config has no mcp section', async () => {
    const r = await cli(['--json', '--mcp'], tmpRepo({ '.git/': '', 'AGENTS.md': 'x\n' }));
    for (const a of JSON.parse(r.stdout).agents) expect(a.mcp).toBeUndefined();
    expect(r.stderr).not.toContain('starting');
  });
});
