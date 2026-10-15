import type { AgentReport, Check, Drop, Report } from '../core/types.ts';

// The plain-language summary: a few sentences and a list of problems, each with a "how to fix"
// line, written for someone who has never seen ctxsize. The terminal and the HTML page both use
// this file, so they always say the same thing. summarize() is copied into the page with
// Function.prototype.toString (the page re-runs it when you change the model or price), so it
// must not use anything from outside itself.

export type Level = 'bad' | 'warn' | 'info';

/** One thing worth fixing, in plain words. */
export interface Problem {
  level: Level;
  /** Stable id of the kind of problem, e.g. "file-truncated" or "skill-no-description". */
  code: string;
  /** A full sentence for the problem list: "ACME.md is too big for Acme Agent, so its end is cut off". */
  title: string;
  /** A few words for a sentence, e.g. "duplicate text in CLAUDE.md and AGENTS.md". */
  short: string;
  /** Simple words: what to do about it. */
  fix: string;
  /** Tool ids the problem concerns. */
  tools: string[];
  /** POSIX paths it is about. */
  paths: string[];
}

export interface SummaryAgent {
  id: string;
  label: string;
  startup: number;
  /** True when startup is an estimate (shown with a ~). */
  est: boolean;
  /** Startup tokens as a percentage of the context window. */
  pct: number;
  /** USD over the messages; null when no price is known. */
  cost: number | null;
}

export interface SummaryInput {
  messages: number;
  agents: SummaryAgent[];
  problems: Problem[];
}

export interface SummaryLine {
  /** bad: red, warn: amber, ok: green, info: neutral. */
  level: 'bad' | 'warn' | 'ok' | 'info';
  text: string;
}

export function summarize(input: SummaryInput): SummaryLine[] {
  const num = (n: number) => Math.round(n).toLocaleString('en-US');
  const pct = (n: number) => (n === 0 ? '0%' : n < 0.1 ? '<0.1%' : `${n.toFixed(n < 10 ? 1 : 0)}%`);
  const usd = (v: number) =>
    v === 0 ? '$0' : v < 0.0001 ? '<$0.0001' : `$${v.toFixed(v < 0.1 ? 4 : 2)}`;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const tok = (a: SummaryAgent) => `${a.est ? '~' : ''}${num(a.startup)}`;
  const lines: SummaryLine[] = [];
  const { agents, problems } = input;

  if (agents.length === 0) {
    return [{ level: 'info', text: 'No agent reads any instruction files from this repo.' }];
  }

  // 1. Who reads the most.
  const biggest = agents.reduce((best, a) => (a.startup > best.startup ? a : best));
  if (biggest && biggest.startup > 0) {
    lines.push({
      level: 'info',
      text: `${biggest.label} reads the most before your first message: ${tok(biggest)} tokens (${pct(biggest.pct)} of its memory).`,
    });
  } else {
    lines.push({
      level: 'info',
      text: 'No agent reads anything from this repo before your first message.',
    });
  }

  // 2. What is cut off.
  const bad = problems.filter((p) => p.level === 'bad');
  if (bad.length === 0) {
    lines.push({
      level: 'ok',
      text: 'Nothing is cut off: every agent reads all of your files in full (within the limits we know).',
    });
  } else {
    const filesOnly = bad.every((p) => p.code === 'file-truncated');
    const noun = filesOnly
      ? plural(bad.length, 'file', 'files')
      : plural(bad.length, 'thing', 'things');
    const verb = filesOnly ? 'cut off' : 'cut off or left out';
    const shown = bad.slice(0, 3).map((p) => p.short);
    const more = bad.length > 3 ? `, and ${bad.length - 3} more` : '';
    lines.push({
      level: 'bad',
      text: `${bad.length} ${noun} ${plural(bad.length, 'is', 'are')} ${verb}: ${shown.join('; ')}${more}.`,
    });
  }

  // 3. What to fix.
  const warn = problems.filter((p) => p.level === 'warn');
  const tips = problems.filter((p) => p.level === 'info');
  const tipText =
    tips.length > 0
      ? ` Plus ${tips.length} optional ${plural(tips.length, 'tip', 'tips')} to save tokens.`
      : '';
  if (warn.length === 0) {
    lines.push({ level: 'ok', text: `Nothing else to fix.${tipText}` });
  } else {
    const shown = warn.slice(0, 3).map((p) => p.short);
    const more = warn.length > 3 ? `, and ${warn.length - 3} more` : '';
    lines.push({
      level: 'warn',
      text: `${warn.length}${bad.length > 0 ? ' more' : ''} ${plural(warn.length, 'thing', 'things')} to fix: ${shown.join(', ')}${more}.${tipText}`,
    });
  }

  // 4. Cost. Agents that read nothing are left out: they are not "cheap", they are empty.
  const reading = agents.filter((a) => a.startup > 0);
  const priced = reading.filter((a) => a.cost !== null);
  if (priced.length >= 2) {
    const cost = (a: SummaryAgent) => a.cost ?? 0;
    const top = priced.reduce((best, a) => (cost(a) > cost(best) ? a : best));
    const low = priced.reduce((best, a) => (cost(a) < cost(best) ? a : best));
    lines.push({
      level: 'info',
      text: `Most expensive over ${num(input.messages)} messages: ${top.label} (${usd(cost(top))}). Cheapest: ${low.label} (${usd(cost(low))}).`,
    });
  } else if (reading.length >= 2) {
    const least = reading.reduce((best, a) => (a.startup < best.startup ? a : best));
    lines.push({
      level: 'info',
      text: `Reads the least: ${least.label} (${tok(least)} tokens). No price is known, so no cost is shown.`,
    });
  } else if (priced.length === 1 && priced[0]) {
    lines.push({
      level: 'info',
      text: `Over ${num(input.messages)} messages ${priced[0].label} costs about ${usd(priced[0].cost ?? 0)}.`,
    });
  }
  return lines;
}

// ---------------------------------------------------------------- Building the input from a report

const num = (n: number) => n.toLocaleString('en-US');
const list = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

function dropProblem(agent: AgentReport, d: Drop): Problem {
  const what = d.skill ? `skill ${d.skill}` : (d.path ?? 'a file');
  const lost = d.tokensLost ? ` (about ${num(d.tokensLost)} tokens lost)` : '';
  const base = { tools: [agent.agent], paths: d.path ? [d.path] : [] };
  switch (d.kind) {
    case 'file-truncated':
      return {
        ...base,
        level: 'bad',
        code: 'file-truncated',
        title: `${what} is too big for ${agent.label}, so the end of it is cut off${lost}`,
        short: `${what} is too big for ${agent.label}`,
        fix: 'Make the file shorter, or move parts that are only needed sometimes into a skill or a rule that loads on demand.',
      };
    case 'file-dropped':
      return {
        ...base,
        level: 'bad',
        code: 'file-dropped',
        title: `${what} is not loaded by ${agent.label} at all, because the size limit was already used up${lost}`,
        short: `${what} is left out by ${agent.label}`,
        fix: 'Shorten the files that load before it, or move the important lines into a file that loads first.',
      };
    case 'import-too-deep':
      return {
        ...base,
        level: d.certainty === 'will' ? 'bad' : 'warn',
        code: 'import-too-deep',
        title: `${what} is pulled in through too many @imports for ${agent.label}, so it is skipped`,
        short: `${what} is imported too deep for ${agent.label}`,
        fix: 'Import it from the main file directly instead of through another imported file.',
      };
    case 'skill-description-truncated':
      return {
        ...base,
        level: d.certainty === 'will' ? 'bad' : 'warn',
        code: 'skill-description-truncated',
        title: `${what} has a description that is cut off for ${agent.label}${lost}`,
        short: `${what} is cut off for ${agent.label}`,
        fix: "Shorten the skill's description and put the most important words first.",
      };
    case 'skill-omitted':
      return {
        ...base,
        level: d.certainty === 'will' ? 'bad' : 'warn',
        code: 'skill-omitted',
        title: `${what} is left out of ${agent.label}'s skill list, so the agent will not know about it`,
        short: `${what} is left out by ${agent.label}`,
        fix: 'Remove skills you do not use, or shorten descriptions so that all of them fit.',
      };
    case 'skill-description-dropped':
      return {
        ...base,
        level: 'warn',
        code: 'skill-description-dropped',
        title: `${what} may lose its description in ${agent.label}`,
        short: `${what} may lose its description in ${agent.label}`,
        fix: 'Shorten skill descriptions, or remove skills you do not use.',
      };
    case 'over-recommended-size':
      return {
        ...base,
        level: 'warn',
        code: 'over-recommended-size',
        title: `${what} is longer than ${agent.label} recommends, so some of it may be ignored`,
        short: `${what} is longer than ${agent.label} recommends`,
        fix: 'Split it: keep the essentials, and move the rest into smaller files that load only when needed.',
      };
    case 'legacy':
      return {
        ...base,
        level: 'warn',
        code: 'legacy',
        title: `${what} is an old file type that ${agent.label} may not load any more`,
        short: `${what} is an old file type`,
        fix: "Move what is in it to the file type the tool recommends now (see the tool's docs).",
      };
  }
}

const CHECK_TEXT: Record<string, { short: (c: Check) => string; fix: string }> = {
  'duplicate-file': {
    short: (c) => `duplicate file ${list(c.paths)}`,
    fix: 'Keep one copy and delete the other, or make one file point to the other.',
  },
  'near-identical-files': {
    short: (c) => `near-identical files ${list(c.paths)}`,
    fix: 'Keep one of them, or move the shared text into a single file.',
  },
  'duplicate-paragraphs': {
    short: (c) => `duplicate text in ${list(c.paths)}`,
    fix: 'Keep the repeated text in one file only (usually AGENTS.md) and remove it from the others.',
  },
  'duplicate-skill': {
    short: () => 'a skill defined twice',
    fix: 'Delete one of the two copies of the skill.',
  },
  'move-to-skill': {
    short: () => 'a big section that could be a skill',
    fix: 'Move that section into a skill, so it loads only when the agent needs it.',
  },
  'trim-startup': {
    short: () => 'a big startup load with no skills',
    fix: 'Trim the biggest file, or move parts that are only needed sometimes into rules that load on demand.',
  },
  'skill-no-description': {
    short: (c) => `a skill with no description (${skillName(c)})`,
    fix: 'Add a description: one sentence saying what the skill does and when to use it.',
  },
  'skill-near-cutoff': {
    short: (c) => `a skill description close to being cut (${skillName(c)})`,
    fix: 'Shorten the description a little so it is not cut off.',
  },
  'skill-vague': {
    short: (c) => `a vague skill description (${skillName(c)})`,
    fix: "Rewrite the description to say what the skill does and when to use it, for example 'Use when ...'.",
  },
  'skill-no-trigger': {
    short: (c) => `a skill with no 'Use when' (${skillName(c)})`,
    fix: "Start the description with 'Use when ...' so the agent knows when to pick the skill.",
  },
  'skill-overlap': {
    short: () => 'two skills that sound alike',
    fix: 'Make each description say clearly when to use that skill and not the other, or merge them.',
  },
};

const skillName = (c: Check) => /^skills? (\S+)/.exec(c.message)?.[1] ?? 'a skill';

function checkProblem(c: Check, label: Map<string, string>): Problem {
  const text = CHECK_TEXT[c.code];
  const who = c.tool ? `${label.get(c.tool) ?? c.tool}: ` : '';
  const message = c.message.charAt(0).toUpperCase() + c.message.slice(1);
  return {
    level: c.severity === 'warn' ? 'warn' : 'info',
    code: c.code,
    title: `${who}${message}`,
    short: text?.short(c) ?? c.message,
    fix:
      text?.fix ??
      'Open the file and tidy it up, or run ctxsize --json for the details of this check.',
    tools: c.tool ? [c.tool] : [],
    paths: c.paths,
  };
}

/** Every drop and check as a problem, worst first. Several at-risk skills of one tool are one problem. */
export function buildProblems(report: Report): Problem[] {
  const out: Problem[] = [];
  const label = new Map(report.agents.map((a) => [a.agent, a.label]));
  for (const agent of report.agents) {
    const risk = agent.drops.filter(
      (d) => d.certainty !== 'will' && d.kind === 'skill-description-dropped',
    );
    for (const d of agent.drops) {
      if (d.certainty === 'advice') continue;
      if (risk.includes(d) && risk.length > 3) continue;
      out.push(dropProblem(agent, d));
    }
    if (risk.length > 3) {
      const tokens = risk.reduce((s, d) => s + (d.tokensLost ?? 0), 0);
      out.push({
        level: 'warn',
        code: 'skill-description-dropped',
        title: `${risk.length} skill descriptions may be dropped by ${agent.label} (${num(tokens)} tokens), so it may not know when to use them`,
        short: `${risk.length} skill descriptions may be dropped by ${agent.label}`,
        fix: 'Remove skills you do not use, or shorten their descriptions so that all of them fit.',
        tools: [agent.agent],
        paths: [],
      });
    }
  }
  for (const c of report.checks) out.push(checkProblem(c, label));
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank[a.p.level] - rank[b.p.level] || a.i - b.i)
    .map((x) => x.p);
}

export function summaryInput(report: Report): SummaryInput {
  return {
    messages: report.messages,
    agents: report.agents.map((a) => ({
      id: a.agent,
      label: a.label,
      startup: a.startup.total,
      est: !a.model.exactTokenizer,
      pct: a.usage.startupPctOfContext,
      cost: a.usage.overheadCostUsd,
    })),
    problems: buildProblems(report),
  };
}

export function reportSummary(report: Report): SummaryLine[] {
  return summarize(summaryInput(report));
}
