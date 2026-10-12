import path from 'node:path';
import { loadConfig } from '../config.ts';
import { simulate } from '../simulate.ts';
import { buildTools, type Tool } from '../tools.ts';
import { VERSION } from '../version.ts';
import { clearWalkCache, findRoot } from './fs.ts';
import { countTokens } from './tokenize.ts';
import {
  type AgentReport,
  CATEGORIES,
  type Category,
  type LoadedItem,
  type Report,
  type ToolId,
} from './types.ts';

export interface AnalyzeOptions {
  /** Directory the agents start in. */
  cwd: string;
  /** Tool ids to measure; default: every tool. */
  agents?: readonly ToolId[];
  /** Tools to choose from; default: the built-ins plus those in the repo's ctxsize.json. */
  tools?: readonly Tool[];
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
  const tools = opts.tools ?? buildTools(loadConfig(root));
  const agents: AgentReport[] = [];

  for (const agent of opts.agents ?? tools.map((t) => t.id)) {
    const tool = tools.find((t) => t.id === agent);
    if (!tool) throw new Error(`unknown tool: ${agent}`);
    const ctx = {
      root,
      cwd,
      env,
      ...(opts.home !== undefined ? { home: opts.home } : {}),
      ...(opts.contextTokens !== undefined ? { contextTokens: opts.contextTokens } : {}),
    };
    const result = await tool.loader(ctx);
    const loaded: LoadedItem[] = result.items
      .map((item) => ({ ...item, tokens: countTokens(item.text) }))
      .sort((a, b) => a.order - b.order);
    const contextTokens = opts.contextTokens ?? tool.defaultContextTokens;
    const sim = simulate({
      agent,
      items: loaded,
      contextTokens,
      contextGiven: opts.contextTokens !== undefined,
      env,
      ...(tool.spec ? { spec: tool.spec } : {}),
    });
    agents.push(summarize(agent, tool.label, contextTokens, sim.items, sim, result.warnings));
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
  agent: ToolId,
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
