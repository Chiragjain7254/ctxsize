import type { AgentReport, Check, Drop, Report, Warning } from '../core/types.ts';
import { createFmt, type Fmt } from './format.ts';

// The plain-language summary and the list of things to fix, written for someone who has never
// seen ctxsize. The terminal and the HTML page both use this file, so they always say the same
// thing: one list of problems (buildProblems) is the only source for the verdict, the counts,
// each agent's status and the fix list. createSummary() is copied into the page with
// Function.prototype.toString (the page re-runs it when you change the model, the price or the
// agents shown), so it must not use anything from outside itself.

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
  /** Tool ids the problem concerns. Every problem names the agents it affects. */
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
  /** The agents to talk about (the ones shown). */
  agents: SummaryAgent[];
  /** Every problem of the run; the ones that concern no shown agent are ignored. */
  problems: Problem[];
}

export interface SummaryLine {
  /** bad: red, warn: amber, ok: green, info: neutral. */
  level: 'bad' | 'warn' | 'ok' | 'info';
  text: string;
}

/** How one agent is doing, from the same problem list as everything else. */
export interface AgentStatus {
  level: 'bad' | 'warn' | 'ok';
  /** Things cut off or left out. */
  bad: number;
  /** Other things worth fixing. */
  warn: number;
  /** Optional tips (they do not change the level). */
  tips: number;
}

export interface Insights {
  /** Agents the numbers are about. */
  agents: SummaryAgent[];
  /** The problems that concern those agents, worst first. */
  problems: Problem[];
  /** The agent that reads the most; null when none reads anything. */
  mostReads: SummaryAgent | null;
  /** Things cut off or left out. */
  cutOff: number;
  /** "file" when every one of them is a cut-off file, else "thing". */
  cutNoun: 'file' | 'thing';
  /** Everything worth fixing: cut off plus at risk. One number, used everywhere. */
  toFix: number;
  tips: number;
  /** The worst few things to fix, for the first screen. */
  fixFirst: Problem[];
  verdict: SummaryLine;
  /** The cost sentence, or null when it would say nothing. */
  cost: SummaryLine | null;
}

/** How many fixes the first screen shows. */
export const FIX_FIRST = 3;

export function createSummary(f: Fmt) {
  const { num, pct, usd, plural } = f;
  const tok = (a: SummaryAgent) => `${a.est ? '~' : ''}${num(a.startup)}`;
  const names = (list: SummaryAgent[]) =>
    list.length <= 2
      ? list.map((a) => a.label).join(' and ')
      : `${list
          .slice(0, -1)
          .map((a) => a.label)
          .join(', ')} and ${list[list.length - 1]?.label}`;

  /** Problems that concern at least one of the agents (or no agent at all). */
  function forAgents(problems: Problem[], ids: string[]): Problem[] {
    return problems.filter((p) => p.tools.length === 0 || p.tools.some((t) => ids.includes(t)));
  }

  function statusOf(problems: Problem[], id: string): AgentStatus {
    const mine = problems.filter((p) => p.tools.includes(id));
    const bad = mine.filter((p) => p.level === 'bad').length;
    const warn = mine.filter((p) => p.level === 'warn').length;
    const tips = mine.filter((p) => p.level === 'info').length;
    return { level: bad > 0 ? 'bad' : warn > 0 ? 'warn' : 'ok', bad, warn, tips };
  }

  function costLine(agents: SummaryAgent[], messages: number): SummaryLine | null {
    const readers = agents.filter((a) => a.startup > 0 && a.cost !== null);
    const cost = (a: SummaryAgent) => a.cost ?? 0;
    if (readers.length >= 2) {
      const top = readers.reduce((best, a) => (cost(a) > cost(best) ? a : best));
      const low = readers.reduce((best, a) => (cost(a) < cost(best) ? a : best));
      // Say what is left out, so "cheapest" never silently skips an agent that is $0.
      const left = agents.filter((a) => !readers.includes(a));
      const empty = left.filter((a) => a.startup === 0);
      const unpriced = left.filter((a) => a.startup > 0);
      const why: string[] = [];
      if (empty.length > 0) {
        why.push(
          `${names(empty)} ${plural(empty.length, 'is', 'are')} left out because ${plural(empty.length, 'it reads', 'they read')} nothing from this repo`,
        );
      }
      if (unpriced.length > 0) why.push(`${names(unpriced)}: no price known`);
      return {
        level: 'info',
        text: `Most expensive over ${num(messages)} messages: ${top.label} (${usd(cost(top))}). Cheapest: ${low.label} (${usd(cost(low))}).${why.length > 0 ? ` ${why.join('; ')}.` : ''}`,
      };
    }
    const reading = agents.filter((a) => a.startup > 0);
    if (reading.length >= 2) {
      const least = reading.reduce((best, a) => (a.startup < best.startup ? a : best));
      return {
        level: 'info',
        text: `Reads the least: ${least.label} (${tok(least)} tokens). No price is known, so no cost is shown.`,
      };
    }
    const only = readers[0];
    if (only) {
      return {
        level: 'info',
        text: `Over ${num(messages)} messages ${only.label} costs about ${usd(only.cost)}.`,
      };
    }
    return null;
  }

  function insights(input: SummaryInput): Insights {
    const { agents } = input;
    const problems = forAgents(
      input.problems,
      agents.map((a) => a.id),
    );
    const bad = problems.filter((p) => p.level === 'bad');
    const toFix = problems.filter((p) => p.level !== 'info');
    const cutNoun = bad.every((p) => p.code === 'file-truncated') ? 'file' : 'thing';
    const reading = agents.filter((a) => a.startup > 0);
    const mostReads = reading.length
      ? reading.reduce((best, a) => (a.startup > best.startup ? a : best))
      : null;

    // A file or two cut off is still "mostly fine" (amber); several is red.
    const lead = bad.length < 3 ? 'Mostly fine' : 'Needs attention';
    const level = bad.length < 3 ? 'warn' : 'bad';
    const cutText = `${bad.length} ${plural(bad.length, cutNoun, `${cutNoun}s`)} ${plural(bad.length, 'is', 'are')} ${cutNoun === 'file' ? 'cut off' : 'cut off or left out'}`;
    const worth = `${toFix.length} ${plural(toFix.length, 'thing is', 'things are')} worth fixing`;
    let verdict: SummaryLine;
    if (agents.length === 0) {
      verdict = { level: 'info', text: 'No agent files found in this repo.' };
    } else if (toFix.length === 0) {
      verdict = { level: 'ok', text: 'All good — nothing is cut off and nothing needs fixing.' };
    } else if (bad.length === 0) {
      verdict = { level: 'warn', text: `Mostly fine — nothing is cut off, but ${worth}.` };
    } else if (bad.length === toFix.length) {
      verdict = { level: level, text: `${lead} — ${cutText}. That is all that needs fixing.` };
    } else {
      verdict = { level: level, text: `${lead} — ${cutText}, and ${worth} in all.` };
    }
    return {
      agents,
      problems,
      mostReads,
      cutOff: bad.length,
      cutNoun,
      toFix: toFix.length,
      tips: problems.length - toFix.length,
      fixFirst: toFix.slice(0, 3),
      verdict,
      cost: agents.length > 0 ? costLine(agents, input.messages) : null,
    };
  }

  /** The terminal's summary, from the same insights the page shows. */
  function summarize(input: SummaryInput): SummaryLine[] {
    const i = insights(input);
    if (i.agents.length === 0) {
      return [{ level: 'info', text: 'No agent reads any instruction files from this repo.' }];
    }
    const lines: SummaryLine[] = [i.verdict];
    const most = i.mostReads;
    lines.push({
      level: 'info',
      text: most
        ? `${most.label} reads the most before your first message: ${tok(most)} tokens (${pct(most.pct)} of its memory).`
        : 'No agent reads anything from this repo before your first message.',
    });
    if (i.cost) lines.push(i.cost);
    if (i.tips > 0) {
      lines.push({
        level: 'info',
        text: `Plus ${i.tips} optional ${plural(i.tips, 'tip', 'tips')} to save tokens.`,
      });
    }
    return lines;
  }

  return { insights, summarize, statusOf, forAgents };
}

const S = createSummary(createFmt());
export const insights = S.insights;
export const statusOf = S.statusOf;
export const forAgents = S.forAgents;

export function summarize(input: SummaryInput): SummaryLine[] {
  return S.summarize(input);
}

// ---------------------------------------------------------------- Building the problems from a report

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

const skillName = (c: Check) => /^skills? ([^\s:]+)/.exec(c.message)?.[1] ?? 'a skill';

/**
 * The agents a finding is about. A check that names no tool (a skill without a description, a
 * big section) concerns every agent that loads one of its files: otherwise that agent would be
 * marked "Fine" while the page lists a problem in its own files.
 */
function checkTools(c: Check, report: Report): string[] {
  if (c.tool) return [c.tool];
  const loading = (a: AgentReport) =>
    a.items.some((i) => c.paths.includes(i.path) && i.load !== 'ignored');
  return report.agents.filter(loading).map((a) => a.agent);
}

function checkProblem(c: Check, report: Report): Problem {
  const text = CHECK_TEXT[c.code];
  const tools = checkTools(c, report);
  const only = tools.length === 1 ? report.agents.find((a) => a.agent === tools[0]) : undefined;
  const who = c.tool && only ? `${only.label}: ` : '';
  const message = c.message.charAt(0).toUpperCase() + c.message.slice(1);
  return {
    level: c.severity === 'warn' ? 'warn' : 'info',
    code: c.code,
    title: `${who}${message}`,
    short: text?.short(c) ?? c.message,
    fix:
      text?.fix ??
      'Open the file and tidy it up, or run ctxsize --json for the details of this check.',
    tools,
    paths: c.paths,
  };
}

// ---------------------------------------------------------------- Warnings: a problem or a note

/** What a loader warning is: something to fix, something a check or a drop already reports, or a note. */
function warningKind(w: Warning): 'problem' | 'covered' | 'note' {
  const m = w.message;
  if (m === 'skill has no description') return 'covered'; // the skill-no-description check
  if (m.startsWith('import too deep')) return 'covered'; // the import-too-deep drop
  if (m.startsWith('docs do not say') || m.startsWith('import outside the repo')) return 'note';
  return 'problem';
}

/** The warnings that stay in the fine print: notes only. Anything to fix is in the problem list. */
export function noteWarnings(agent: AgentReport): Warning[] {
  return agent.warnings.filter((w) => warningKind(w) === 'note');
}

/** A warning about a file the user can fix (bad YAML, a missing import) is a problem like any other. */
function warningProblems(report: Report): Problem[] {
  const merged = new Map<string, Problem>();
  for (const agent of report.agents) {
    for (const w of agent.warnings) {
      if (warningKind(w) !== 'problem') continue;
      const key = `${w.path ?? ''}\n${w.message}`;
      const known = merged.get(key);
      if (known) {
        known.tools.push(agent.agent);
        continue;
      }
      merged.set(key, {
        level: 'warn',
        code: 'file-problem',
        title: `${w.path ? `${w.path}: ` : ''}${w.message}`,
        short: w.path ? `a problem in ${w.path}` : w.message,
        fix: 'Open the file and correct it, then run ctxsize again to check.',
        tools: [agent.agent],
        paths: w.path ? [w.path] : [],
      });
    }
  }
  return [...merged.values()];
}

/** Every drop, check and file warning as a problem, worst first. Several at-risk skills of one tool are one problem. */
export function buildProblems(report: Report): Problem[] {
  const out: Problem[] = [];
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
  for (const c of report.checks) out.push(checkProblem(c, report));
  out.push(...warningProblems(report));
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
