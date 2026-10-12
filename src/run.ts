import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.ts';
import { analyze } from './core/analyze.ts';
import { dirExists, findRoot } from './core/fs.ts';
import type { ToolId } from './core/types.ts';
import { allModels, type ModelChoice, presets } from './models.ts';
import { toJson } from './report/json.ts';
import { renderTerminal } from './report/terminal.ts';
import { buildTools } from './tools.ts';
import { VERSION } from './version.ts';

export const EXIT = { ok: 0, overBudget: 1, usage: 2 } as const;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  cwd: string;
}

const presetIds = () => presets.map((m) => m.id).join(', ');
const BUILT_IN = buildTools().map((t) => t.id);

const HELP = `ctxsize v${VERSION}
See what every coding agent loads before your first prompt, in tokens,
and what each one silently drops.

Usage: ctxsize [dir] [options]

Options:
  --agents <list>      Comma-separated tool ids (default: all). Built in: ${BUILT_IN.join(',')}
                       plus any tool defined in ctxsize.json
  --context <tokens>   Context window to model (default: the model's own)
  --model <choice>     Model: an id for every tool, or tool=id pairs (see MODELS below)
  --price <usd>        USD per 1M input tokens, replacing every model's price
  --include-user       Also read files from your home directory (not reproducible)
  --json               Print the report as JSON
  --html               Write a treemap to ctxsize-report.html (or --out <file>)
  --out <file>         Where to write --html
  --max-tokens <n>     Exit 1 if any agent loads more than n tokens at startup
  --no-color           Disable colors (NO_COLOR is honoured too)
  -v, --version        Print the version
  -h, --help           Print this help

Models: ${presetIds()} (add or change them in ctxsize.json)

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

  let tools: ReturnType<typeof buildTools>;
  let models: ReturnType<typeof allModels>;
  let choice: ModelChoice;
  try {
    const config = loadConfig(findRoot(parsed.dir));
    tools = buildTools(config);
    models = allModels(config?.models);
    choice = modelChoice(
      config,
      parsed.modelFlag,
      tools.map((t) => t.id),
      models,
    );
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    io.stderr(`ctxsize: ${err.message}
`);
    return EXIT.usage;
  }
  const ids = tools.map((t) => t.id);
  let agents: ToolId[] = ids;
  if (parsed.agentNames !== undefined) {
    const unknown = parsed.agentNames.filter((n) => !ids.includes(n));
    if (unknown.length > 0 || parsed.agentNames.length === 0) {
      io.stderr(
        `ctxsize: unknown agent: ${unknown.join(', ') || '(none)'} (choose from ${ids.join(', ')})
Run ctxsize --help for usage.
`,
      );
      return EXIT.usage;
    }
    agents = ids.filter((id) => parsed.agentNames?.includes(id));
  }

  const report = await analyze({
    cwd: parsed.dir,
    agents,
    tools,
    models: { models, choice, ...(parsed.price !== undefined ? { price: parsed.price } : {}) },
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
      model: { type: 'string' },
      price: { type: 'string' },
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

  const agentNames =
    values.agents === undefined
      ? undefined
      : values.agents
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);

  if (values.out !== undefined && !values.html) throw new UsageError('--out needs --html');

  const color =
    !values['no-color'] &&
    !values.json &&
    io.env.NO_COLOR === undefined &&
    (io.isTTY || (io.env.FORCE_COLOR !== undefined && io.env.FORCE_COLOR !== '0'));

  return {
    dir,
    agentNames,
    context: positiveInt(values.context, '--context'),
    modelFlag: values.model,
    price: nonNegativeNumber(values.price, '--price'),
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

function nonNegativeNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`${flag} must be a number of USD, 0 or more, got "${value}"`);
  }
  return n;
}

/** Combines the config's per-tool models with --model (which wins). */
function modelChoice(
  config: ReturnType<typeof loadConfig>,
  flag: string | undefined,
  toolIds: string[],
  models: Map<string, unknown>,
): ModelChoice {
  const choice: ModelChoice = { perTool: {} };
  for (const [id, tool] of Object.entries(config?.tools ?? {})) {
    if (tool.model !== undefined) choice.perTool[id] = tool.model;
  }
  if (flag !== undefined) {
    for (const part of flag
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const eq = part.indexOf('=');
      if (eq === -1) {
        choice.all = part;
      } else {
        const tool = part.slice(0, eq).toLowerCase();
        if (!toolIds.includes(tool)) {
          throw new ConfigError(
            `--model: unknown tool "${tool}" (choose from ${toolIds.join(', ')})`,
          );
        }
        choice.perTool[tool] = part.slice(eq + 1);
      }
    }
  }
  for (const wanted of [choice.all, ...Object.values(choice.perTool)]) {
    if (wanted !== undefined && !models.has(wanted)) {
      throw new ConfigError(
        `unknown model "${wanted}" (choose from ${[...models.keys()].join(', ')})`,
      );
    }
  }
  return choice;
}
