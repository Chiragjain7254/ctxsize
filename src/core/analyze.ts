import path from 'node:path';
import { loaders } from '../agents/index.ts';
import { profiles } from '../profiles.ts';
import { simulate } from '../simulate.ts';
import { VERSION } from '../version.ts';
import { clearWalkCache, findRoot } from './fs.ts';
import { countTokens } from './tokenize.ts';
import {
  type AgentId,
  type AgentReport,
  CATEGORIES,
  type Category,
  type LoadedItem,
  type Report,
} from './types.ts';

export interface AnalyzeOptions {
  /** Directory the agents start in. */
  cwd: string;
  agents: readonly AgentId[];
  /** Home directory to read user-level files from; omit for reproducible output. */
  home?: string;
  env?: Record<string, string | undefined>;
  contextTokens?: number;
}

export async function analyze(opts: AnalyzeOptions): Promise<Report> {
  const cwd = path.resolve(opts.cwd);
  clearWalkCache();
  const root = findRoot(cwd);
  const env = opts.env ?? {};
  const agents: AgentReport[] = [];

  for (const agent of opts.agents) {
    const ctx = {
      root,
      cwd,
      env,
      ...(opts.home !== undefined ? { home: opts.home } : {}),
      ...(opts.contextTokens !== undefined ? { contextTokens: opts.contextTokens } : {}),
    };
    const result = await loaders[agent](ctx);
    const loaded: LoadedItem[] = result.items
      .map((item) => ({ ...item, tokens: countTokens(item.text) }))
      .sort((a, b) => a.order - b.order);
    const profile = profiles[agent];
    const contextTokens = opts.contextTokens ?? profile.defaultContextTokens;
    const sim = simulate({
      agent,
      items: loaded,
      contextTokens,
      contextGiven: opts.contextTokens !== undefined,
      env,
    });
    agents.push(summarize(agent, profile.label, contextTokens, sim.items, sim, result.warnings));
  }

  return {
    schemaVersion: 1,
    tool: { name: 'ctxsize', version: VERSION },
    tokenizer: 'o200k_base (estimate)',
    root: '.',
    agents,
  };
}

function summarize(
  agent: AgentId,
  label: string,
  contextTokens: number,
  items: LoadedItem[],
  sim: { drops: AgentReport['drops']; notes: string[] },
  warnings: AgentReport['warnings'],
): AgentReport {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  let total = 0;
  let onDemandTotal = 0;
  let onDemandCount = 0;
  for (const item of items) {
    if (item.load === 'startup') {
      byCategory[item.category] += item.tokens;
      total += item.tokens;
    } else if (item.load === 'on-demand') {
      onDemandTotal += item.tokens;
      onDemandCount++;
    }
  }
  return {
    agent,
    label,
    contextTokens,
    notes: sim.notes,
    startup: { total, byCategory },
    onDemand: { total: onDemandTotal, count: onDemandCount },
    items,
    drops: sim.drops,
    warnings,
  };
}
