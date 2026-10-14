import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { analyzeRevision, openRepo, validateRef } from '../src/history.ts';
import { sparkline } from '../src/report/diff.ts';
import { EXIT, run } from '../src/run.ts';
import { buildTools } from '../src/tools.ts';
import { tmpRepo } from './helpers.ts';

// Every test builds a real git repo, which is slow on Windows.
vi.setConfig({ testTimeout: 60_000 });

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=t@example.com'];
  const quiet = ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
  return execFileSync('git', [...identity, ...quiet, ...args], { cwd, encoding: 'utf8' });
}

function put(dir: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function commit(dir: string, message: string, files: Record<string, string> = {}) {
  put(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

function newRepo(): string {
  const dir = tmpRepo({});
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

async function cli(argv: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    env: {},
    isTTY: false,
    cwd,
  });
  return { code, stdout, stderr };
}

const words = (n: number, w = 'alpha') => `${Array.from({ length: n }, () => w).join(' ')}\n`;
type Tools = Record<string, number>;
type Entry = { subject: string; tools: Tools; commit: string; date: string };

/** Five commits: add files, add a rule, touch nothing relevant, rename + grow, delete a file. */
function story() {
  const dir = newRepo();
  commit(dir, 'one', { 'CLAUDE.md': words(100), 'AGENTS.md': words(40, 'beta') });
  commit(dir, 'two', { '.claude/rules/style.md': words(60, 'gamma') });
  commit(dir, 'three', { 'README.md': 'nothing to see\n' });
  git(dir, 'mv', '.claude/rules/style.md', '.claude/rules/format.md');
  commit(dir, 'four', { 'CLAUDE.md': words(250) });
  git(dir, 'rm', '-q', 'AGENTS.md');
  commit(dir, 'five');
  return dir;
}

/** What a plain run says about these files: startup tokens per tool. */
async function direct(files: Record<string, string>): Promise<Tools> {
  const dir = tmpRepo({ '.git/': '', ...files });
  const tools = buildTools();
  const report = await analyze({
    cwd: dir,
    tools,
    agents: tools.map((t) => t.id),
    messages: 50,
  });
  return Object.fromEntries(report.agents.map((a) => [a.agent, a.startup.total]));
}

describe('--history', () => {
  test('startup tokens per commit match a plain run on those files', async () => {
    const dir = story();
    const r = await cli(['--history', '5', '--json', dir], dir);
    expect(r.code).toBe(EXIT.ok);
    const out = JSON.parse(r.stdout);
    expect(out.analyzed).toBe(5);
    expect(out.shallow).toBe(false);
    const history: Entry[] = out.history;
    expect(history.map((h) => h.subject)).toEqual(['one', 'two', 'three', 'four', 'five']);

    const agents = { 'AGENTS.md': words(40, 'beta') };
    const one = { 'CLAUDE.md': words(100), ...agents };
    const two = { ...one, '.claude/rules/style.md': words(60, 'gamma') };
    const four = {
      'CLAUDE.md': words(250),
      ...agents,
      '.claude/rules/format.md': words(60, 'gamma'),
    };
    const five = { 'CLAUDE.md': words(250), '.claude/rules/format.md': words(60, 'gamma') };
    const expected = await Promise.all([one, two, two, four, five].map((f) => direct(f)));
    expect(history.map((h) => h.tools)).toEqual(expected);

    // The commit that touched nothing relevant equals the one before it.
    expect(history[2]?.tools).toEqual(history[1]?.tools);
    expect(history[1]?.tools.claude).toBeGreaterThan(history[0]?.tools.claude ?? 0);
    expect(history[4]?.tools.codex).toBeLessThan(history[3]?.tools.codex ?? 0);
    expect(history[0]?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(history[0]?.date ?? ''))).toBe(false);
  });

  test('asking for more commits than exist uses what exists and says so', async () => {
    const dir = story();
    const r = await cli(['--history', '50', '--no-color', dir], dir);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('Only 5 of 50 commits exist on this branch');
    expect(r.stdout).toMatch(/[▁-█]{5}/);
    const limited = JSON.parse((await cli(['--history', '2', '--json', dir], dir)).stdout);
    expect(limited.history.map((h: Entry) => h.subject)).toEqual(['four', 'five']);
  });

  test('a shallow clone yields the commits it has', async () => {
    const src = story();
    const holder = tmpRepo({});
    const clone = path.join(holder, 'clone');
    git(holder, 'clone', '-q', '--depth', '2', `file://${src.split(path.sep).join('/')}`, clone);
    const r = await cli(['--history', '10', '--json', clone], clone);
    expect(r.code).toBe(EXIT.ok);
    const out = JSON.parse(r.stdout);
    expect(out.analyzed).toBe(2);
    expect(out.shallow).toBe(true);
    const text = await cli(['--history', '10', '--no-color', clone], clone);
    expect(text.stdout).toContain('shallow clone');
  });

  test('follows the first parent through a merge', async () => {
    const dir = newRepo();
    commit(dir, 'base', { 'CLAUDE.md': words(10) });
    git(dir, 'checkout', '-q', '-b', 'side');
    commit(dir, 'side work', { 'CLAUDE.md': words(500) });
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'main work', { 'AGENTS.md': words(10) });
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const out = JSON.parse((await cli(['--history', '10', '--json', dir], dir)).stdout);
    const history: Entry[] = out.history;
    expect(history.map((h) => h.subject)).toEqual(['base', 'main work', 'merge side']);
    expect(history[2]?.tools.claude).toBeGreaterThan(history[1]?.tools.claude ?? 0);
  });

  test('an empty repository has an empty history', async () => {
    const dir = newRepo();
    const json = await cli(['--history', '3', '--json', dir], dir);
    expect(json.code).toBe(EXIT.ok);
    expect(JSON.parse(json.stdout).history).toEqual([]);
    expect((await cli(['--history', '3', dir], dir)).stdout).toContain('No commits yet');
  });

  test('rejects bad counts and conflicting flags', async () => {
    const dir = story();
    const bad = [
      ['--history', '0'],
      ['--history', '201'],
      ['--history', 'x'],
      ['--history', '3', '--diff', 'HEAD'],
      ['--history', '3', '--max-tokens', '5'],
    ];
    for (const argv of bad) expect((await cli([...argv, dir], dir)).code).toBe(EXIT.usage);
  });

  test('outside a git repository it is a usage error', async () => {
    const dir = tmpRepo({ 'CLAUDE.md': 'x\n' });
    const r = await cli(['--history', '3', dir], dir);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('not a git repository');
  });
});

describe('--diff', () => {
  test('reports the change per tool and per file against a ref', async () => {
    const dir = story();
    put(dir, {
      'CLAUDE.md': words(400),
      'docs/new.md': 'ignored\n',
      '.claude/rules/extra.md': words(30, 'delta'),
    });
    const r = await cli(['--diff', 'HEAD~3', '--json', '--all', dir], dir);
    expect(r.code).toBe(EXIT.ok);
    const out = JSON.parse(r.stdout);
    expect(out.agents).toHaveLength(buildTools().length); // the usual output is intact
    expect(out.diff.base.ref).toBe('HEAD~3');
    expect(out.diff.base.commit).toBe(git(dir, 'rev-parse', 'HEAD~3').trim());

    const before = await direct({
      'CLAUDE.md': words(100),
      'AGENTS.md': words(40, 'beta'),
      '.claude/rules/style.md': words(60, 'gamma'),
    });
    const after = await direct({
      'CLAUDE.md': words(400),
      '.claude/rules/format.md': words(60, 'gamma'),
      '.claude/rules/extra.md': words(30, 'delta'),
    });
    type Tool = { agent: string; before: number; files: { path: string; status: string }[] };
    const claude = out.diff.tools.find((t: Tool) => t.agent === 'claude');
    expect(claude.before).toBe(before.claude);
    expect(claude.after).toBe(after.claude);
    expect(claude.delta).toBe((after.claude ?? 0) - (before.claude ?? 0));
    expect(claude.deltaPct).toBe(
      Math.round((((after.claude ?? 0) - (before.claude ?? 0)) / (before.claude ?? 1)) * 1000) / 10,
    );
    expect(claude.overhead.deltaTokens).toBe(claude.delta * 50);
    const status = Object.fromEntries(
      claude.files.map((f: Tool['files'][0]) => [f.path, f.status]),
    );
    expect(status).toEqual({
      'CLAUDE.md': 'changed',
      '.claude/rules/style.md': 'removed',
      '.claude/rules/format.md': 'added',
      '.claude/rules/extra.md': 'added',
    });
    const codex = out.diff.tools.find((t: Tool) => t.agent === 'codex');
    expect(codex.files.map((f: Tool['files'][0]) => f.path)).toEqual(['AGENTS.md']);
    expect(codex.delta).toBe(-codex.before);

    const text = (await cli(['--diff', 'HEAD~3', '--no-color', dir], dir)).stdout;
    expect(text).toContain('Change since HEAD~3');
    expect(text).toContain('+ .claude/rules/format.md');
    expect(text).toContain('- .claude/rules/style.md');
  });

  test('works from a subfolder and with a branch name', async () => {
    const dir = story();
    git(dir, 'branch', 'old', 'HEAD~4');
    const sub = path.join(dir, 'pkg');
    mkdirSync(sub);
    const r = await cli(['--diff', 'old', '--json', sub], sub);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.stdout).diff.base.ref).toBe('old');
  });

  test('the exit code only reflects --max-tokens on the working tree', async () => {
    const dir = story();
    expect((await cli(['--diff', 'HEAD~1', dir], dir)).code).toBe(EXIT.ok);
    const over = await cli(['--diff', 'HEAD~1', '--max-tokens', '1', dir], dir);
    expect(over.code).toBe(EXIT.overBudget);
  });

  test('a bad ref, an option-looking ref and a non-repository are usage errors', async () => {
    const dir = story();
    const bad = await cli(['--diff', 'no-such-ref', dir], dir);
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.stderr).toContain('unknown git ref');
    for (const ref of ['--upload-pack=evil', '-x', '']) {
      const r = await cli([`--diff=${ref}`, dir], dir);
      expect(r.code).toBe(EXIT.usage);
      expect(r.stdout).toBe('');
    }
    expect(() => validateRef('-x')).toThrow();
    const plain = tmpRepo({ 'CLAUDE.md': 'x\n' });
    const r = await cli(['--diff', 'HEAD', plain], plain);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('not a git repository');
    const empty = newRepo();
    expect((await cli(['--diff', 'HEAD', empty], empty)).code).toBe(EXIT.usage);
  });
});

describe('the working tree stays untouched', () => {
  function snapshot(dir: string) {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          const body = createHash('sha1').update(readFileSync(full)).digest('hex');
          out[path.relative(dir, full)] = `${statSync(full).mtimeMs}:${body}`;
        }
      }
    };
    walk(dir);
    return out;
  }

  test('--diff and --history change no file, no mtime, no index', async () => {
    const dir = story();
    put(dir, { 'CLAUDE.md': words(300), 'untracked.md': 'u\n' });
    git(dir, 'add', 'untracked.md');
    const status = git(dir, 'status', '--porcelain');
    const files = snapshot(dir); // includes .git, so the index and refs are covered too
    await cli(['--diff', 'HEAD~2', dir], dir);
    await cli(['--history', '5', dir], dir);
    const after = snapshot(dir); // before running git again: `git status` refreshes the index
    expect(Object.keys(after)).toEqual(Object.keys(files));
    for (const [file, state] of Object.entries(files)) expect(after[file], file).toBe(state);
    expect(git(dir, 'status', '--porcelain')).toBe(status);
    expect(git(dir, 'stash', 'list')).toBe('');
  });
});

describe('which files are copied out of git', () => {
  test('every built-in tool sees at a commit what it sees in the working tree', async () => {
    const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`;
    const files: Record<string, string> = {
      'CLAUDE.md': '# Claude\n@docs/imported.md\n',
      'docs/imported.md': 'Imported text for claude and gemini.\n',
      '.claude/CLAUDE.md': 'dot claude\n',
      '.claude/rules/a.md': 'claude rule\n',
      '.claude/skills/s1/SKILL.md': skill('s1'),
      'AGENTS.md': 'agents file\n',
      'AGENTS.override.md': 'override\n',
      'sub/AGENTS.md': 'nested agents\n',
      'sub/CLAUDE.md': 'nested claude\n',
      '.agents/skills/s2/SKILL.md': skill('s2'),
      '.cursor/rules/r.mdc': '---\nalwaysApply: true\n---\ncursor rule\n',
      '.cursorrules': 'legacy cursor\n',
      '.windsurfrules': 'legacy windsurf\n',
      '.github/copilot-instructions.md': 'copilot repo\n',
      '.github/instructions/ts.instructions.md': '---\napplyTo: "**/*.ts"\n---\nts rules\n',
      'GEMINI.md': 'gemini\n',
      'CONTEXT.md': 'custom gemini context name\n',
      '.gemini/settings.json': '{"context":{"fileName":["CONTEXT.md","GEMINI.md"]}}\n',
      '.gemini/skills/g/SKILL.md': skill('g'),
      'CONVENTIONS.md': 'aider\n',
      '.clinerules/a.md': 'cline\n',
      '.cline/rules/b.md': 'cline too\n',
      '.windsurf/rules/w.md': '---\ntrigger: always_on\n---\nwindsurf\n',
      '.devin/rules/d.md': 'devin\n',
      '.rules': 'zed\n',
      'src/app.ts': 'code that no tool loads\n',
    };
    const dir = newRepo();
    commit(dir, 'all of it', files);
    const tools = buildTools();
    const opts = { agents: tools.map((t) => t.id), tools, messages: 50 };
    const here = await analyze({ cwd: dir, ...opts });
    const then = await analyzeRevision(await openRepo(dir), 'HEAD', opts, tools);
    const shape = (r: typeof here) =>
      r.agents.map((a) => ({
        id: a.agent,
        items: a.items.map((i) => [i.path, i.load, i.tokens]),
        total: a.startup.total,
      }));
    expect(shape(then)).toEqual(shape(here));
    for (const tool of tools.filter((t) => t.origin === 'built-in')) {
      expect(then.agents.find((a) => a.agent === tool.id)?.items.length, tool.id).toBeGreaterThan(
        0,
      );
    }
  });

  test('tools defined in ctxsize.json are covered too', async () => {
    const dir = newRepo();
    const config = {
      tools: {
        mine: { label: 'Mine', instructions: ['docs/ai/*.txt'], rules: [{ dir: 'ai-rules' }] },
      },
    };
    commit(dir, 'one', {
      'ctxsize.json': JSON.stringify(config),
      'docs/ai/guide.txt': words(50),
      'ai-rules/x.md': words(20),
    });
    commit(dir, 'two', { 'docs/ai/guide.txt': words(200) });
    const r = await cli(['--history', '2', '--agents', 'mine', '--json', dir], dir);
    const history: Entry[] = JSON.parse(r.stdout).history;
    expect(history[0]?.tools.mine).toBeGreaterThan(0);
    expect(history[1]?.tools.mine).toBeGreaterThan(history[0]?.tools.mine ?? 0);
  });
});

describe('sparkline', () => {
  test('scales between min and max', () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█');
    expect(sparkline([5, 5, 5])).toBe('▁▁▁');
    expect(sparkline([])).toBe('');
    expect(sparkline(Array.from({ length: 200 }, (_, i) => i))).toHaveLength(60);
  });
});

describe('--history --html', () => {
  test('writes a self-contained chart page with a legend and a table', async () => {
    const dir = story();
    const out = path.join(tmpRepo({}), 'history.html');
    const r = await cli(
      ['--history', '5', '--html', '--out', out, '--agents', 'claude,codex', dir],
      dir,
    );
    expect(r.code).toBe(EXIT.ok);
    const html = readFileSync(out, 'utf8');
    expect(html).toContain('Startup tokens over the last 5 commits');
    expect(html).toContain('<polyline');
    expect(html).toContain('Claude Code');
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toContain('<script');
    expect((html.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  test('a subject with markup is escaped', async () => {
    const dir = newRepo();
    commit(dir, '<img src=x onerror=alert(1)>', { 'CLAUDE.md': words(50) });
    const out = path.join(tmpRepo({}), 'h.html');
    await cli(['--history', '1', '--html', '--out', out, '--agents', 'claude', dir], dir);
    expect(readFileSync(out, 'utf8')).not.toContain('<img src=x');
  });
});

describe('niceAxis', () => {
  test('rounds up to a readable top with about five ticks', async () => {
    const { niceAxis } = await import('../src/report/history-html.ts');
    expect(niceAxis(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(niceAxis(8819).top).toBe(10000);
    expect(niceAxis(8819).ticks).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
    expect(niceAxis(283).top).toBe(300);
  });
});
