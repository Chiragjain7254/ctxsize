import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.ts';
import { analyze } from './core/analyze.ts';
import { dirExists, findRoot } from './core/fs.ts';
import type { AgentReport, Report, ToolId } from './core/types.ts';
import { DEFAULT_MESSAGES } from './core/usage.ts';
import {
  computeDiff,
  computeHistory,
  type DiffResult,
  HistoryError,
  MAX_HISTORY,
  openRepo,
  type SnapshotOptions,
  validateRef,
} from './history.ts';
import { allModels, type ModelChoice, modelForTool, presets } from './models.ts';
import { openInBrowser } from './open.ts';
import { renderDiff, renderHistory } from './report/diff.ts';
import { toJson } from './report/json.ts';
import { renderSummary, renderTerminal, SORT_KEYS, type SortKey } from './report/terminal.ts';
import type { ReportServer } from './serve.ts';
import { buildTools, type Tool } from './tools.ts';
import { VERSION } from './version.ts';
import { watchLoop } from './watch.ts';

export const EXIT = { ok: 0, overBudget: 1, usage: 2 } as const;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  isTTY: boolean;
  cwd: string;
  /** Stops --watch; by default Ctrl+C does. */
  signal?: AbortSignal | undefined;
  /** Opens a file or URL in the default browser for --open and --serve; returns an error message on failure. */
  open?: ((target: string) => Promise<string | undefined>) | undefined;
}

const presetIds = () => presets.map((m) => m.id).join(', ');
const BUILT_IN = buildTools().map((t) => t.id);

const HELP = `ctxsize v${VERSION}
See what every coding agent loads before your first prompt, in tokens,
and what each one silently drops.

Usage: ctxsize [dir] [options]

Options:
  --agents <list>      Comma-separated tool ids (default: all). Built in: ${BUILT_IN.join(',')}
                       plus any tool defined in ctxsize.json. Listed tools are always shown
  --all                Show every tool, including those that load nothing (hidden by default)
  --context <tokens>   Context window to model (default: the model's own)
  --model <choice>     Model: an id for every tool, or tool=id pairs (see MODELS below)
  --price <usd>        USD per 1M input tokens, replacing every model's price
  --messages <n>       Messages assumed for the overhead cost (default: ${DEFAULT_MESSAGES})
  --include-user       Also read files from your home directory (not reproducible)
  --json               Print the report as JSON
  --html               Write a treemap to ctxsize-report.html (or --out <file>)
  --mcp                START the local MCP servers in this repo's config and count their tool
                       tokens (runs the configured commands; remote servers are never contacted)
  --tree               Also show the startup load when the agent starts in each nested folder
  --out <file>         Where to write --html
  --open               Open the --html report in the default browser
  --serve              Serve the interactive report at http://localhost:4321 and keep it up to
                       date as files change (Ctrl+C to stop); opens your browser
  --port <n>           First port for --serve (default 4321; the next 9 are tried if it is taken)
  --no-open            With --serve, do not open the browser
  --markdown <file>    Write a pull-request comment summary ("-" prints it instead of the table)
  --card <file.svg>    Write an SVG summary card (--title sets its heading)
  --badge <file.svg>   Write an SVG README badge and print the shields.io snippet
  --title <text>       Heading for --card
  --watch              Re-run when files in the repo change (Ctrl+C to stop). With --html, the
                       open page updates itself from a .data.js file written next to it
  --diff <git ref>     Also compare with the same repo at <ref> (a branch, tag or commit)
  --history <n>        Trend of startup tokens over the last n commits (1-200); no working tree
  --max-tokens <n>     Exit 1 if any agent loads more than n tokens at startup
  --check-profiles     Print every documented agent limit with its source URL and checked date
  --no-checks          Skip the duplicate, suggestion and skill-health checks
  --quiet              Print only a one-line summary, gate failures and errors (for CI)
  --sort <key>         Order the agent tables: startup (biggest first), name or cost
  --no-color           Disable colors (NO_COLOR is honoured too)
  -v, --version        Print the version
  -h, --help           Print this help

Models: ${presetIds()} (add or change them in ctxsize.json)

Exit codes: 0 ok, 1 over --max-tokens, 2 usage error.
Tokens are estimates (o200k_base). Nothing is sent anywhere.
`;

class UsageError extends Error {}

/** After an HTML report is written: open it with --open, otherwise hint at the flag. */
async function announceHtml(file: string, open: boolean, quiet: boolean, io: Io): Promise<void> {
  if (!open) {
    if (!quiet)
      io.stderr('Open it with: ctxsize --html --open, or view it live with: ctxsize --serve\n');
    return;
  }
  const error = await (io.open ?? openInBrowser)(file);
  if (error) io.stderr(`ctxsize: could not open the browser: ${error}\n`);
}

/** ctxsize-report.html -> ctxsize-report.data.js, the file the page polls in watch mode. */
const dataFileFor = (html: string) => `${html.replace(/.html?$/i, '')}.data.js`;

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
  if (parsed.checkProfiles) {
    const { renderProfiles } = await import('./check-profiles.ts');
    io.stdout(renderProfiles());
    return EXIT.ok;
  }
  if (parsed.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT.ok;
  }

  /** Progress messages; --quiet keeps stderr for gate failures and errors only. */
  const info = (text: string): void => {
    if (!parsed.quiet) io.stderr(text);
  };

  let tools: ReturnType<typeof buildTools>;
  let models: ReturnType<typeof allModels>;
  let choice: ModelChoice;
  let messagesFromConfig: number | undefined;
  try {
    const config = loadConfig(findRoot(parsed.dir));
    messagesFromConfig = config?.messages;
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

  const root = findRoot(parsed.dir);
  const analyzeOpts = {
    agents,
    tools,
    messages: parsed.messages ?? messagesFromConfig ?? DEFAULT_MESSAGES,
    models: { models, choice, ...(parsed.price !== undefined ? { price: parsed.price } : {}) },
    env: io.env,
    checks: !parsed.noChecks,
    ...(parsed.includeUser ? { home: os.homedir() } : {}),
    ...(parsed.context !== undefined ? { contextTokens: parsed.context } : {}),
  };
  const analyzeOptions = (cwd: string) => ({ cwd, root, ...analyzeOpts });

  if (parsed.history !== undefined) {
    return runHistory(parsed, analyzeOpts, tools, io);
  }

  // Sharing outputs load lazily: most runs never use them.
  const share =
    parsed.markdown || parsed.card || parsed.badge ? await import('./report/share.ts') : undefined;

  let server: ReportServer | undefined;
  if (parsed.serve) {
    const { startReportServer } = await import('./serve.ts');
    try {
      server = await startReportServer(parsed.port === undefined ? {} : { port: parsed.port });
    } catch (err) {
      io.stderr(
        `ctxsize: could not start the server: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return EXIT.usage;
    }
  }

  // One analysis plus its output; --watch calls it again after every change.
  const once = async (rerun: boolean): Promise<Report> => {
    const report = await analyze(analyzeOptions(parsed.dir));
    {
      const { attachMcp } = await import('./mcp/index.ts');
      await attachMcp(report, root, {
        measure: parsed.mcp,
        tokenizerFor: (id) => modelForTool(id, models, choice).model.tokenizer,
        log: (line) =>
          info(`${line}
`),
      });
    }
    if (parsed.tree) {
      const { analyzeTree } = await import('./tree.ts');
      const tree = await analyzeTree(report, root, (cwd) =>
        analyze({ ...analyzeOptions(cwd), checks: false }),
      );
      report.tree = tree.rows;
      if (tree.skipped > 0) {
        io.stderr(`ctxsize: --tree lists ${tree.rows.length} folders; ${tree.skipped} more were skipped
`);
      }
    }

    let diff: DiffResult | undefined;
    if (parsed.diff !== undefined) {
      try {
        const repo = await openRepo(parsed.dir);
        diff = await computeDiff(repo, parsed.diff, report, analyzeOpts, tools);
      } catch (err) {
        if (!(err instanceof HistoryError)) throw err;
        throw new UsageError(err.message);
      }
    }

    // Tools that load nothing are hidden unless asked for; --agents names tools on purpose.
    if (!parsed.all && parsed.agentNames === undefined) {
      const empty = (a: AgentReport) => a.startup.total === 0 && a.onDemand.total === 0;
      report.hidden = report.agents.filter(empty).map((a) => ({ agent: a.agent, label: a.label }));
      report.agents = report.agents.filter((a) => !empty(a));
    }

    // --serve: hand the new report to the server instead of printing it.
    if (server) {
      server.update(await (await import('./serve.ts')).renderPage(report, models));
      return report;
    }

    if (rerun && io.isTTY) io.stdout('[2J[3J[H');
    if (parsed.json) {
      io.stdout(toJson(report, diff ? { diff } : {}));
    } else if (parsed.markdown === '-' && share) {
      io.stdout(share.renderMarkdown(report));
    } else {
      if (parsed.quiet) {
        io.stdout(renderSummary(report));
      } else {
        io.stdout(renderTerminal(report, { color: parsed.color, sort: parsed.sort }));
        if (diff) io.stdout(renderDiff(diff, { color: parsed.color }));
      }
    }

    if (parsed.html) {
      // Loaded lazily: most runs never write HTML.
      const { renderHtml, renderDataJs } = await import('./report/html.ts');
      const live = parsed.watch
        ? { watch: { file: path.basename(dataFileFor(parsed.out)) }, generated: String(Date.now()) }
        : {};
      writeFileSync(parsed.out, renderHtml(report, { models, ...live }));
      // Only in watch mode: the open page polls this file for new data.
      if (parsed.watch)
        writeFileSync(dataFileFor(parsed.out), renderDataJs(report, { models, ...live }));
      info(`Wrote ${parsed.out}\n`);
      // In watch mode, open the page once; later runs refresh it in place.
      if (!rerun) await announceHtml(parsed.out, parsed.open, parsed.quiet, io);
    }
    if (share) {
      if (parsed.markdown && parsed.markdown !== '-') {
        writeFileSync(parsed.markdown, share.renderMarkdown(report));
        info(`Wrote ${parsed.markdown}
  `);
      }
      if (parsed.card) {
        writeFileSync(parsed.card, share.renderCardSvg(report, { title: parsed.title }));
        info(`Wrote ${parsed.card}
  `);
      }
      if (parsed.badge) {
        writeFileSync(parsed.badge, share.renderBadgeSvg(report));
        info(`Wrote ${parsed.badge}
  README snippet (shields.io static badge): ${share.badgeMarkdown(report)}
  `);
      }
    }

    return report;
  };

  if (server) {
    // The same watch loop as --watch: each change re-runs the analysis and pushes it to the page.
    const live = server;
    let announced = false;
    await watchLoop({
      root,
      signal: io.signal,
      once: async (rerun) => {
        await once(rerun);
        if (announced) return;
        announced = true;
        io.stderr(`ctxsize report running at ${live.url} — press Ctrl+C to stop\n`);
        if (parsed.noOpen) return;
        const error = await (io.open ?? openInBrowser)(live.url);
        if (error) io.stderr(`ctxsize: could not open the browser: ${error}\n`);
      },
      onError: (err) => io.stderr(`ctxsize: ${err instanceof Error ? err.message : String(err)}\n`),
    });
    await live.close();
    return EXIT.ok;
  }
  if (parsed.watch) {
    io.stderr(`ctxsize: watching ${root} (Ctrl+C to stop)\n`);
    await watchLoop({
      root,
      ignorePaths: [parsed.out, dataFileFor(parsed.out)],
      signal: io.signal,
      once: async (rerun) => {
        await once(rerun);
        io.stderr(`ctxsize: updated ${new Date().toLocaleTimeString()}, watching for changes\n`);
      },
      onError: (err) => io.stderr(`ctxsize: ${err instanceof Error ? err.message : String(err)}\n`),
    });
    return EXIT.ok;
  }
  let report: Report;
  try {
    report = await once(false);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`ctxsize: ${err.message}
`);
    return EXIT.usage;
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

/** --history: startup tokens per commit; the working tree is not analyzed. */
async function runHistory(
  parsed: {
    dir: string;
    history?: number;
    json: boolean;
    color: boolean;
    html: boolean;
    out: string;
    open: boolean;
  },
  opts: SnapshotOptions,
  tools: Tool[],
  io: Io,
): Promise<number> {
  try {
    const repo = await openRepo(parsed.dir);
    const result = await computeHistory(repo, parsed.history ?? 1, opts, tools);
    const labels = Object.fromEntries(tools.map((t) => [t.id, t.label]));
    if (parsed.html) {
      const { renderHistoryHtml } = await import('./report/history-html.ts');
      writeFileSync(parsed.out, renderHistoryHtml(result, { labels, version: VERSION }));
      io.stderr(`Wrote ${parsed.out}
`);
      await announceHtml(parsed.out, parsed.open, false, io);
    }
    if (parsed.json) {
      const { entries, ...meta } = result;
      const tool = { name: 'ctxsize', version: VERSION };
      io.stdout(`${JSON.stringify({ tool, root: '.', ...meta, history: entries }, null, 2)}\n`);
    } else {
      io.stdout(renderHistory(result, { color: parsed.color, labels }));
    }
    return EXIT.ok;
  } catch (err) {
    if (!(err instanceof HistoryError)) throw err;
    io.stderr(`ctxsize: ${err.message}\n`);
    return EXIT.usage;
  }
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
      messages: { type: 'string' },
      diff: { type: 'string' },
      history: { type: 'string' },
      all: { type: 'boolean', default: false },
      serve: { type: 'boolean', default: false },
      port: { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      'include-user': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      html: { type: 'boolean', default: false },
      open: { type: 'boolean', default: false },
      out: { type: 'string' },
      tree: { type: 'boolean', default: false },
      mcp: { type: 'boolean', default: false },
      markdown: { type: 'string' },
      card: { type: 'string' },
      badge: { type: 'string' },
      title: { type: 'string' },
      'max-tokens': { type: 'string' },
      'no-checks': { type: 'boolean', default: false },
      'check-profiles': { type: 'boolean', default: false },
      watch: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      sort: { type: 'string' },
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

  if (values.watch && values.mcp) {
    throw new UsageError(
      '--watch cannot be combined with --mcp: it would restart the servers on every change',
    );
  }
  if (values.quiet && (values.serve || values.watch)) {
    throw new UsageError('--quiet cannot be combined with --serve or --watch');
  }
  if (values.out !== undefined && !values.html) throw new UsageError('--out needs --html');
  if (values.open && !values.html && !values.serve) {
    throw new UsageError('--open needs --html (or --serve)');
  }
  if (values.port !== undefined && !values.serve) throw new UsageError('--port needs --serve');
  if (values['no-open'] && !values.serve) throw new UsageError('--no-open needs --serve');
  if (values.open && values['no-open']) throw new UsageError('use --open or --no-open, not both');
  if (values.serve) {
    const clash = (
      [
        ['html', '--html'],
        ['json', '--json'],
        ['markdown', '--markdown'],
        ['card', '--card'],
        ['badge', '--badge'],
        ['diff', '--diff'],
        ['history', '--history'],
        ['mcp', '--mcp'],
        ['max-tokens', '--max-tokens'],
      ] as const
    ).find(([key]) => values[key] !== undefined && values[key] !== false);
    if (clash) throw new UsageError(`--serve cannot be combined with ${clash[1]}`);
  }
  if (values.watch && values['max-tokens'] !== undefined) {
    throw new UsageError(
      '--watch cannot be combined with --max-tokens (it never exits on its own)',
    );
  }

  const history = positiveInt(values.history, '--history');
  if (history !== undefined && history > MAX_HISTORY) {
    throw new UsageError(`--history must be between 1 and ${MAX_HISTORY}, got ${history}`);
  }
  if (values.diff !== undefined) {
    try {
      validateRef(values.diff);
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
  }
  if (history !== undefined) {
    if (values.diff !== undefined) throw new UsageError('use --diff or --history, not both');
    if (values['max-tokens'] !== undefined) {
      throw new UsageError('--max-tokens cannot be combined with --history');
    }
  }

  const sort = values.sort as SortKey | undefined;
  if (sort !== undefined && !SORT_KEYS.includes(sort)) {
    throw new UsageError(`--sort must be one of ${SORT_KEYS.join(', ')}, got "${values.sort}"`);
  }

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
    messages: positiveInt(values.messages, '--messages'),
    maxTokens: positiveInt(values['max-tokens'], '--max-tokens', true),
    diff: values.diff,
    history,
    all: values.all,
    includeUser: values['include-user'],
    noChecks: values['no-checks'],
    quiet: values.quiet,
    sort,
    checkProfiles: values['check-profiles'],
    json: values.json,
    html: values.html,
    open: values.open,
    serve: values.serve,
    port: nonNegativeInt(values.port, '--port', 65535),
    noOpen: values['no-open'],
    tree: values.tree,
    mcp: values.mcp,
    watch: values.watch,
    out: path.resolve(io.cwd, values.out ?? 'ctxsize-report.html'),
    markdown:
      values.markdown === '-' ? '-' : values.markdown && path.resolve(io.cwd, values.markdown),
    card: values.card && path.resolve(io.cwd, values.card),
    badge: values.badge && path.resolve(io.cwd, values.badge),
    title: values.title,
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

function nonNegativeInt(value: string | undefined, flag: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new UsageError(`${flag} must be a whole number from 0 to ${max}, got "${value}"`);
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
