import type { AgentReport, Drop, DropKind, Report } from '../core/types.ts';
import { formatUsd, TOP_FILES } from '../core/usage.ts';
import { hiddenSentence, tokenizerSentence } from './common.ts';
import { fmt } from './format.ts';
import { buildProblems, type Problem, reportSummary } from './summary.ts';

export type SortKey = 'startup' | 'name' | 'cost';
export const SORT_KEYS: readonly SortKey[] = ['startup', 'name', 'cost'];

export interface TerminalOptions {
  color: boolean;
  /** Order of the agent and cost tables; default: the order of the tools. */
  sort?: SortKey | undefined;
  /** How many "Biggest files" to list (default 5). */
  top?: number | undefined;
}

const KIND_LABEL: Record<DropKind, string> = {
  'file-truncated': 'cut',
  'file-dropped': 'dropped',
  'import-too-deep': 'import too deep',
  'skill-description-truncated': 'description cut',
  'skill-description-dropped': 'description may drop',
  'skill-omitted': 'skill left out',
  'over-recommended-size': 'over recommended size',
  legacy: 'legacy, may not load',
};

/** Most lines to print per agent per section before "+N more". */
const MAX_LINES = 8;

/** --quiet: one line with the startup tokens of every agent shown. */
/** The agents ordered for the tables: biggest first for startup and cost, A to Z for name. */
export function sortAgents(agents: AgentReport[], sort: SortKey | undefined): AgentReport[] {
  if (sort === undefined) return agents;
  const cost = (a: AgentReport) => a.usage.overheadCostUsd ?? -1;
  const key = {
    startup: (a: AgentReport, b: AgentReport) => b.startup.total - a.startup.total,
    cost: (a: AgentReport, b: AgentReport) => cost(b) - cost(a),
    name: (a: AgentReport, b: AgentReport) => a.label.localeCompare(b.label, 'en'),
  }[sort];
  return [...agents].sort((a, b) => key(a, b) || a.label.localeCompare(b.label, 'en'));
}

export function renderSummary(report: Report): string {
  if (report.agents.length === 0) return 'ctxsize: no agent loads any files from this repo\n';
  const parts = report.agents.map((a) => `${a.label} ~${a.startup.total.toLocaleString('en-US')}`);
  return `ctxsize: startup tokens (estimates): ${parts.join(', ')}\n`;
}

export function renderTerminal(report: Report, opts: TerminalOptions): string {
  const c = colors(opts.color);
  const out: string[] = [];
  out.push(
    `${c.bold('ctxsize')} ${c.dim(`v${report.tool.version}`)}  what each agent loads before your first prompt`,
  );
  out.push('');
  out.push(...summaryLines(report, c));
  if (report.agents.length > 0) {
    out.push(...table(sortAgents(report.agents, opts.sort), c));
  } else {
    out.push('  No agent loads any files from this repo.');
  }
  const hidden = hiddenSentence(report);
  if (hidden) out.push('', c.dim(hidden));
  if (report.agents.length > 0) {
    out.push(...costLines({ ...report, agents: sortAgents(report.agents, opts.sort) }, c));
  }
  out.push(...biggestFiles(report, c, opts.top ?? TOP_FILES));
  out.push(...treeLines(report, c));
  out.push(...mcpLines(report, c));

  const dropped = report.agents.filter((a) => a.drops.length > 0);
  if (dropped.length > 0) {
    out.push('', c.bold('Dropped or at risk'));
    for (const agent of dropped) out.push(...dropLines(agent, c));
  }

  out.push(...checkLines(report, c));

  const noted = report.agents.filter((a) => a.notes.length > 0);
  if (noted.length > 0) {
    out.push('', c.bold('Notes'));
    for (const agent of noted) {
      for (const note of agent.notes) out.push(`  ${agent.label}: ${note}`);
    }
  }

  const warned = report.agents.filter((a) => a.warnings.length > 0);
  if (warned.length > 0) {
    out.push('', c.bold('Warnings'));
    for (const agent of warned) {
      const lines = agent.warnings.map(
        (w) => `  ${c.yellow('!')} ${agent.label}: ${w.path ? `${w.path}: ` : ''}${w.message}`,
      );
      out.push(...capped(lines, c));
    }
  }

  out.push(
    '',
    c.dim(tokenizerSentence(report)),
    c.dim("Your files only: agents' own system prompts and tools are not counted."),
  );
  return `${out.join('\n')}\n`;
}

/** The plain-language summary and the problems with a fix each; the tables come after. */
function summaryLines(report: Report, c: Colors): string[] {
  const mark = { bad: c.red('✗'), warn: c.yellow('!'), ok: c.green('✓'), info: c.dim('-') };
  const out = [
    c.bold('Summary'),
    ...reportSummary(report).map((l) => `  ${mark[l.level]} ${l.text}`),
  ];
  const problems = buildProblems(report);
  const toFix = problems.filter((p) => p.level !== 'info');
  const tips = problems.filter((p) => p.level === 'info');
  if (toFix.length > 0) {
    out.push('', c.bold(`${toFix.length} ${fmt.plural(toFix.length, 'thing', 'things')} to fix`));
    out.push(...toFix.flatMap((p) => problemLines(p, c)));
  }
  if (tips.length > 0) {
    out.push('', c.bold(`${tips.length} optional ${fmt.plural(tips.length, 'tip', 'tips')}`));
    out.push(...tips.flatMap((p) => problemLines(p, c)));
  }
  return [...out, ''];
}

function problemLines(p: Problem, c: Colors): string[] {
  const mark = { bad: c.red('✗'), warn: c.yellow('!'), info: c.dim('i') }[p.level];
  return [`  ${mark} ${p.title}`, c.dim(`      How to fix: ${p.fix}`)];
}

function table(agents: AgentReport[], c: Colors): string[] {
  const header = ['Agent', 'Instructions', 'Rules', 'Skills', 'Startup', '% ctx', 'On demand'];
  const rows = agents.map((a) => [
    a.label,
    num(a.startup.byCategory.instructions + a.startup.byCategory.memory),
    num(a.startup.byCategory.rules),
    num(a.startup.byCategory.skills),
    `${a.model.exactTokenizer ? '' : '~'}${num(a.startup.total)}`,
    pct(a.usage.startupPctOfContext),
    a.onDemand.count ? `${num(a.onDemand.total)} (${a.onDemand.count})` : '0',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[], style: (s: string, i: number) => string) =>
    `  ${cells
      .map((cell, i) => {
        const w = widths[i] ?? 0;
        const padded = i === 0 ? cell.padEnd(w) : cell.padStart(w);
        return style(padded, i);
      })
      .join('  ')}`.trimEnd();
  return [
    line(header, (s) => c.dim(s)),
    ...rows.map((r, ri) =>
      line(r, (s, i) => {
        if (i === 4) return c.bold(s);
        if (i === 0 && (agents[ri]?.drops.some((d) => d.certainty === 'will') ?? false)) {
          return c.red(s);
        }
        return s;
      }),
    ),
  ];
}

function dropLines(agent: AgentReport, c: Colors): string[] {
  const out = [`  ${c.bold(agent.label)}`];
  const will = agent.drops.filter((d) => d.certainty === 'will');
  const atRisk = agent.drops.filter((d) => d.certainty === 'at-risk');
  const advice = agent.drops.filter((d) => d.certainty === 'advice');

  out.push(
    ...capped(
      will.map((d) => `    ${c.red('✗')} ${describe(d)}`),
      c,
      '    ',
    ),
  );

  // Many skills at risk at once is one finding, not dozens of lines.
  const riskByKind = new Map<DropKind, Drop[]>();
  for (const d of atRisk) riskByKind.set(d.kind, [...(riskByKind.get(d.kind) ?? []), d]);
  for (const [kind, drops] of riskByKind) {
    if (drops.length > 3) {
      const tokens = drops.reduce((s, d) => s + (d.tokensLost ?? 0), 0);
      out.push(
        `    ${c.yellow('?')} ${drops.length} skill ${kind === 'skill-description-dropped' ? 'descriptions' : 'items'} at risk (${num(tokens)} tokens), see notes`,
      );
    } else {
      out.push(...drops.map((d) => `    ${c.yellow('?')} ${describe(d)}`));
    }
  }
  out.push(
    ...capped(
      advice.map((d) => `    ${c.dim('i')} ${describe(d)}`),
      c,
      '    ',
    ),
  );
  return out;
}

function describe(d: Drop): string {
  const what = d.skill ? `skill ${d.skill}` : (d.path ?? '');
  const lost: string[] = [];
  if (d.bytesLost) lost.push(`${num(d.bytesLost)} B`);
  if (d.tokensLost) lost.push(`${num(d.tokensLost)} tokens`);
  return `${KIND_LABEL[d.kind]}: ${what}${lost.length ? `  (−${lost.join(', ')})` : ''}`;
}

function capped(lines: string[], c: Colors, indent = '  '): string[] {
  if (lines.length <= MAX_LINES) return lines;
  return [
    ...lines.slice(0, MAX_LINES),
    c.dim(`${indent}… ${lines.length - MAX_LINES} more (see --json)`),
  ];
}

const num = (n: number) => n.toLocaleString('en-US');

type Colors = ReturnType<typeof colors>;

function colors(enabled: boolean) {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
  };
}

const pct = fmt.pct;

/** 1000000 -> "1M", 400000 -> "400k". */
function windowLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(2)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

function costLines(report: Report, c: Colors): string[] {
  const header = [
    'Agent',
    'Model',
    'Window',
    'Per message',
    `${num(report.messages)} messages`,
    'Cost',
  ];
  const anyDefault = report.agents.some((a) => a.model.isDefault);
  const rows = report.agents.map((a) => [
    a.label,
    `${a.model.label}${a.model.isDefault ? '*' : ''}`,
    windowLabel(a.contextTokens),
    num(a.startup.total),
    num(a.usage.overheadTokens),
    formatUsd(a.usage.overheadCostUsd),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[], style: (s: string) => string) =>
    `  ${cells
      .map((cell, i) => style(i < 2 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join('  ')}`.trimEnd();
  return [
    '',
    c.bold('Cost of carrying it'),
    line(header, (s) => c.dim(s)),
    ...rows.map((r) => line(r, (s) => s)),
    c.dim("  Startup tokens x messages, at each model's uncached input price; caching lowers it."),
    ...(anyDefault ? [c.dim('  * default model: pick one with --model.')] : []),
  ];
}

function biggestFiles(report: Report, c: Colors, limit: number): string[] {
  const byPath = new Map<string, { tokens: number; tools: Set<string> }>();
  for (const a of report.agents) {
    for (const f of a.topFiles) {
      const key = f.skill ? `skill: ${f.skill}` : f.path;
      const entry = byPath.get(key) ?? { tokens: 0, tools: new Set<string>() };
      entry.tokens = Math.max(entry.tokens, f.tokens);
      entry.tools.add(a.label);
      byPath.set(key, entry);
    }
  }
  const top = [...byPath]
    .sort((a, b) => b[1].tokens - a[1].tokens || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
  if (top.length === 0) return [];
  const pathWidth = Math.min(48, Math.max(...top.map(([p]) => p.length)));
  const tokenWidth = Math.max(...top.map(([, v]) => num(v.tokens).length));
  return [
    '',
    c.bold('Biggest files at startup'),
    ...top.map(([p, v]) => {
      const who = v.tools.size > 3 ? `${v.tools.size} tools` : [...v.tools].join(', ');
      return `  ${p.length > pathWidth ? `…${p.slice(-(pathWidth - 1))}` : p.padEnd(pathWidth)}  ${num(v.tokens).padStart(tokenWidth)}  ${c.dim(who)}`;
    }),
  ];
}

function treeLines(report: Report, c: Colors): string[] {
  const rows = report.tree;
  if (!rows) return [];
  const head = ['', c.bold('By starting folder')];
  if (rows.length <= 1) return [...head, c.dim('  No nested instruction files found.')];
  const rootTotals = rows[0]?.tools ?? {};
  // Only tools whose load changes somewhere get a column; the rest are listed once.
  const varying = report.agents.filter((a) =>
    rows.some((r) => (r.tools[a.agent] ?? 0) !== (rootTotals[a.agent] ?? 0)),
  );
  if (varying.length === 0) {
    return [...head, c.dim(`  All ${rows.length} folders load the same as the repo root.`)];
  }
  const cell = (row: (typeof rows)[number], id: string) => {
    const n = row.tools[id] ?? 0;
    const delta = n - (rootTotals[id] ?? 0);
    if (row === rows[0] || delta === 0) return num(n);
    return `${num(n)} (${delta > 0 ? '+' : '-'}${num(Math.abs(delta))})`;
  };
  const dirWidth = Math.min(36, Math.max(6, ...rows.map((r) => r.dir.length)));
  const body = rows.map((row) => varying.map((a) => cell(row, a.agent)));
  const widths = varying.map((a, i) =>
    Math.max(a.label.length, ...body.map((b) => b[i]?.length ?? 0)),
  );
  const shorten = (dir: string) =>
    dir.length > dirWidth ? `…${dir.slice(-(dirWidth - 1))}` : dir.padEnd(dirWidth);
  const same = report.agents.length - varying.length;
  return [
    ...head,
    `  ${c.dim('Folder'.padEnd(dirWidth))}  ${varying.map((a, i) => c.dim(a.label.padStart(widths[i] ?? 0))).join('  ')}`.trimEnd(),
    ...rows.map((row, ri) =>
      `  ${shorten(row.dir)}  ${(body[ri] ?? []).map((text, i) => text.padStart(widths[i] ?? 0)).join('  ')}`.trimEnd(),
    ),
    ...(same > 0 ? [c.dim(`  ${same} other tool(s) load the same in every folder.`)] : []),
  ];
}

function mcpLines(report: Report, c: Colors): string[] {
  const withMcp = report.agents.filter((a) => a.mcp);
  if (withMcp.length === 0) return [];
  const out = ['', c.bold('MCP servers configured in this repo')];
  let anyMeasured = false;
  let anyUnmeasured = false;
  for (const agent of withMcp) {
    const mcp = agent.mcp;
    if (!mcp) continue;
    for (const w of mcp.warnings ?? []) out.push(`  ${c.yellow('!')} ${agent.label}: ${w}`);
    for (const s of mcp.servers) {
      const where = `${agent.label} (${s.configPath})`;
      if (s.status === 'measured') {
        anyMeasured = true;
        out.push(`  ${where}: ${s.name}  ${num(s.tools ?? 0)} tools, ${num(s.tokens ?? 0)} tokens`);
      } else if (s.status === 'failed') {
        out.push(`  ${where}: ${s.name}  ${c.red('failed')}: ${s.message ?? ''}`);
      } else {
        if (s.status === 'not-measured') anyUnmeasured = true;
        out.push(
          `  ${where}: ${s.name}  ${c.dim(s.transport === 'remote' ? 'remote, not contacted' : 'not measured')}`,
        );
      }
    }
    if (mcp.measuredTokens !== null) {
      out.push(`  ${agent.label} total: ${num(mcp.measuredTokens)} tokens of tool definitions`);
    }
  }
  if (anyUnmeasured) {
    out.push(
      c.dim(
        '  Pass --mcp to start the local servers and count their tool tokens (runs the commands in the config).',
      ),
    );
  }
  if (anyMeasured) {
    out.push(
      c.dim(
        '  Upper bound: some tools load MCP tool definitions on demand (Claude Code uses tool search by default).',
      ),
    );
  }
  return out;
}

function checkLines(report: Report, c: Colors): string[] {
  if (report.checks.length === 0) return [];
  const label = new Map(report.agents.map((a) => [a.agent, a.label]));
  const lines = report.checks.map((k) => {
    const mark = k.severity === 'warn' ? c.yellow('!') : c.dim('i');
    const who = k.tool ? `${label.get(k.tool) ?? k.tool}: ` : '';
    const where = k.paths.filter((p) => !k.message.includes(p)).slice(0, 2);
    return `  ${mark} ${who}${k.message}${where.length ? c.dim(` (${where.join(', ')})`) : ''}`;
  });
  return ['', c.bold('Checks'), ...capped(lines, c)];
}
