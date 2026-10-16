import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.ts';
import { analyze } from './core/analyze.ts';
import { dirExists, findRoot } from './core/fs.ts';
import type { Io } from './run.ts';
import { VERSION } from './version.ts';

// `ctxsize init`: a starter ctxsize.json and, if asked, a GitHub workflow. It never overwrites a
// file without --force, never touches the network and asks questions only on a terminal.

const SCHEMA_URL =
  'https://raw.githubusercontent.com/Chiragjain7254/ctxsize/main/schema/ctxsize.schema.json';

export const INIT_HELP = `Usage: ctxsize init [dir] [options]

Create a starter ctxsize.json and, if you want it, a GitHub Actions workflow that fails a
pull request when an agent's startup load grows past a budget. Existing files are never
overwritten without --force.

Options:
  --workflow           Also create .github/workflows/ctxsize.yml
  --no-workflow        Do not create the workflow (and do not ask)
  --max-tokens <n>     The workflow's budget (default: 25% above what the repo loads today)
  --force              Overwrite files that already exist
  --yes                Do not ask questions: use the defaults and the flags
  -h, --help           Print this help

On a terminal ctxsize asks before creating each file; in CI or a pipe it only does what the
flags say (ctxsize.json always, the workflow only with --workflow).
`;

/** The starter config. Valid on its own; every key is optional. */
export function starterConfig(): string {
  return `${JSON.stringify({ $schema: SCHEMA_URL, messages: 50 }, null, 2)}\n`;
}

/** The workflow: ctxsize runs on every pull request and on main. */
export function starterWorkflow(maxTokens: number): string {
  return `# Fails the job when an agent loads more than ${maxTokens.toLocaleString('en-US')} tokens before the first prompt.
# Token counts are estimates. ctxsize makes no network calls and needs no secrets.
name: ctxsize
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ctxsize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Chiragjain7254/ctxsize@v${VERSION}
        with:
          max-tokens: ${maxTokens}
`;
}

/** A budget with room to grow: 25% above today's heaviest agent, rounded up to 500, at least 2,000. */
export function suggestBudget(heaviestStartup: number): number {
  return Math.max(2000, Math.ceil((heaviestStartup * 1.25) / 500) * 500);
}

/** True when the repo already has a ctxsize config (ctxsize.json or a "ctxsize" key in package.json). */
function hasConfig(root: string): boolean {
  try {
    return loadConfig(root) !== undefined;
  } catch (err) {
    if (err instanceof ConfigError) return true; // a broken config is still a config: do not hide it
    throw err;
  }
}

function parseInitArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      workflow: { type: 'boolean', default: false },
      'no-workflow': { type: 'boolean', default: false },
      'max-tokens': { type: 'string' },
      force: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

const WORKFLOW = '.github/workflows/ctxsize.yml';

export async function runInit(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseInitArgs>;
  try {
    parsed = parseInitArgs(argv);
    const { values, positionals } = parsed;
    if (positionals.length > 1)
      throw new Error(`expected one directory, got ${positionals.length}`);
    if (values.workflow && values['no-workflow']) {
      throw new Error('use --workflow or --no-workflow, not both');
    }
    const typed = values['max-tokens'];
    if (typed !== undefined && !/^[1-9][\d_]*$/.test(typed)) {
      throw new Error(`--max-tokens must be a positive whole number, got "${typed}"`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`ctxsize: ${message}\nRun ctxsize init --help for usage.\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(INIT_HELP);
    return 0;
  }
  const dir = path.resolve(io.cwd, positionals[0] ?? '.');
  if (!dirExists(dir)) {
    io.stderr(`ctxsize: not a directory: ${positionals[0] ?? '.'}\n`);
    return 2;
  }
  const root = findRoot(dir);
  const ask = io.ask;
  const interactive = ask !== undefined && !values.yes;
  const confirm = async (question: string, fallback: boolean): Promise<boolean> => {
    if (!interactive) return fallback;
    const answer = (await ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    return answer === '' ? fallback : answer.startsWith('y');
  };

  const written: string[] = [];
  const kept: string[] = [];
  const write = (rel: string, content: string): void => {
    const file = path.join(root, ...rel.split('/'));
    if (existsSync(file) && !values.force) {
      kept.push(rel);
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(rel);
  };

  if (hasConfig(root) && !values.force) {
    kept.push('ctxsize.json');
  } else if (await confirm('Create ctxsize.json?', true)) {
    write('ctxsize.json', starterConfig());
  }

  let wantWorkflow = values.workflow;
  if (!values.workflow && !values['no-workflow']) {
    wantWorkflow = await confirm(`Add a GitHub Actions workflow (${WORKFLOW})?`, false);
  }
  if (wantWorkflow) {
    let budget: number;
    const given = values['max-tokens'];
    if (given !== undefined) {
      budget = Number(given.replaceAll('_', ''));
    } else {
      const report = await analyze({ cwd: root, root });
      budget = suggestBudget(Math.max(0, ...report.agents.map((a) => a.startup.total)));
      if (interactive) {
        const typed = (await ask(`Budget in tokens per agent [${budget}] `)).trim();
        if (typed !== '') {
          budget = Number(typed.replaceAll('_', '').replaceAll(',', ''));
          if (!Number.isInteger(budget) || budget < 1) {
            io.stderr(`ctxsize: the budget must be a positive whole number, got "${typed}"\n`);
            return 2;
          }
        }
      }
    }
    write(WORKFLOW, starterWorkflow(budget));
  }

  for (const rel of written) io.stderr(`Created ${rel}\n`);
  for (const rel of kept) io.stderr(`Kept ${rel} (it exists; use --force to overwrite)\n`);
  if (written.length === 0 && kept.length === 0) io.stderr('Nothing created.\n');
  if (written.includes(WORKFLOW)) {
    io.stderr('Commit the workflow to turn the check on for pull requests.\n');
  }
  if (written.length > 0) io.stderr('Next: run ctxsize to see what your agents load.\n');
  return 0;
}
