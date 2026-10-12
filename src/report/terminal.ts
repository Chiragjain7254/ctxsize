import type { AgentReport, Drop, DropKind, Report } from '../core/types.ts';

export interface TerminalOptions {
  color: boolean;
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

export function renderTerminal(report: Report, opts: TerminalOptions): string {
  const c = colors(opts.color);
  const out: string[] = [];
  out.push(
    `${c.bold('ctxsize')} ${c.dim(`v${report.tool.version}`)}  what each agent loads before your first prompt`,
  );
  out.push('');
  out.push(...table(report.agents, c));

  const dropped = report.agents.filter((a) => a.drops.length > 0);
  if (dropped.length > 0) {
    out.push('', c.bold('Dropped or at risk'));
    for (const agent of dropped) out.push(...dropLines(agent, c));
  }

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
    c.dim(
      `Tokens are estimates (${report.tokenizer.replace(' (estimate)', '')}). Your files only: ` +
        "agents' own system prompts and tools are not counted.",
    ),
  );
  return `${out.join('\n')}\n`;
}

function table(agents: AgentReport[], c: Colors): string[] {
  const header = ['Agent', 'Instructions', 'Rules', 'Skills', 'Startup', 'On demand'];
  const rows = agents.map((a) => [
    a.label,
    num(a.startup.byCategory.instructions + a.startup.byCategory.memory),
    num(a.startup.byCategory.rules),
    num(a.startup.byCategory.skills),
    num(a.startup.total),
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
    yellow: wrap(33, 39),
  };
}
