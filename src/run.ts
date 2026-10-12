import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from './core/analyze.ts';
import { dirExists } from './core/fs.ts';
import { AGENT_IDS, type AgentId } from './core/types.ts';
import { toJson } from './report/json.ts';
import { renderTerminal } from './report/terminal.ts';
import { VERSION } from './version.ts';

export const EXIT = { ok: 0, overBudget: 1, usage: 2 } as const;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  cwd: string;
}

const HELP = `ctxsize v${VERSION}
See what every coding agent loads before your first prompt, in tokens,
and what each one silently drops.

Usage: ctxsize [dir] [options]

Options:
  --agents <list>      Comma-separated: ${AGENT_IDS.join(',')} (default: all)
  --context <tokens>   Context window to model (default: 200000)
  --include-user       Also read files from your home directory (not reproducible)
  --json               Print the report as JSON
  --html               Write a treemap to ctxsize-report.html (or --out <file>)
  --out <file>         Where to write --html
  --max-tokens <n>     Exit 1 if any agent loads more than n tokens at startup
  --no-color           Disable colors (NO_COLOR is honoured too)
  -v, --version        Print the version
  -h, --help           Print this help

Exit codes: 0 ok, 1 over --max-tokens, 2 usage error.
Tokens are estimates (o200k_base). Nothing is sent anywhere.
`;

class UsageError extends Error {}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv, io);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`ctxsize: ${message}\nRun ctxsize --help for usage.\n`);
    return EXIT.usage;
  }
  if (parsed.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  if (parsed.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT.ok;
  }

  const report = await analyze({
    cwd: parsed.dir,
    agents: parsed.agents,
    env: io.env,
    ...(parsed.includeUser ? { home: os.homedir() } : {}),
    ...(parsed.context !== undefined ? { contextTokens: parsed.context } : {}),
  });

  if (parsed.json) {
    io.stdout(toJson(report));
  } else {
    io.stdout(renderTerminal(report, { color: parsed.color }));
  }

  if (parsed.html) {
    // Loaded lazily: most runs never write HTML.
    const { renderHtml } = await import('./report/html.ts');
    writeFileSync(parsed.out, renderHtml(report));
    io.stderr(`Wrote ${parsed.out}\n`);
  }

  if (parsed.maxTokens !== undefined) {
    const over = report.agents.filter((a) => a.startup.total > (parsed.maxTokens ?? 0));
    if (over.length > 0) {
      for (const agent of over) {
        io.stderr(
          `ctxsize: ${agent.label} loads ${agent.startup.total.toLocaleString('en-US')} tokens at startup, over --max-tokens ${parsed.maxTokens.toLocaleString('en-US')}\n`,
        );
      }
      return EXIT.overBudget;
    }
  }
  return EXIT.ok;
}

function parse(argv: string[], io: Io) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agents: { type: 'string' },
      context: { type: 'string' },
      'include-user': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      html: { type: 'boolean', default: false },
      out: { type: 'string' },
      'max-tokens': { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (positionals.length > 1)
    throw new UsageError(`expected one directory, got ${positionals.length}`);
  const dir = path.resolve(io.cwd, positionals[0] ?? '.');
  if (!values.help && !values.version && !dirExists(dir)) {
    throw new UsageError(`not a directory: ${positionals[0] ?? '.'}`);
  }

  let agents: AgentId[] = [...AGENT_IDS];
  if (values.agents !== undefined) {
    const names = values.agents
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unknown = names.filter((n) => !(AGENT_IDS as readonly string[]).includes(n));
    if (unknown.length > 0 || names.length === 0) {
      throw new UsageError(
        `unknown agent: ${unknown.join(', ') || '(none)'} (choose from ${AGENT_IDS.join(', ')})`,
      );
    }
    agents = AGENT_IDS.filter((a) => names.includes(a));
  }

  if (values.out !== undefined && !values.html) throw new UsageError('--out needs --html');

  const color =
    !values['no-color'] &&
    !values.json &&
    io.env.NO_COLOR === undefined &&
    (io.isTTY || (io.env.FORCE_COLOR !== undefined && io.env.FORCE_COLOR !== '0'));

  return {
    dir,
    agents,
    context: positiveInt(values.context, '--context'),
    maxTokens: positiveInt(values['max-tokens'], '--max-tokens', true),
    includeUser: values['include-user'],
    json: values.json,
    html: values.html,
    out: path.resolve(io.cwd, values.out ?? 'ctxsize-report.html'),
    color,
    help: values.help,
    version: values.version,
  };
}

function positiveInt(
  value: string | undefined,
  flag: string,
  allowZero = false,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.replaceAll('_', ''));
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
    throw new UsageError(
      `${flag} must be a ${allowZero ? 'non-negative' : 'positive'} whole number, got "${value}"`,
    );
  }
  return n;
}
