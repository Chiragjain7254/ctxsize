import path from 'node:path';
import { computeChecks, skillDescriptionLimits } from '../checks.ts';
import { loadConfig } from '../config.ts';
import { genericModel, type Model, type ModelChoice, modelForTool, modelInfo } from '../models.ts';
import { DEFAULT_CONTEXT_TOKENS } from '../profiles.ts';
import { simulate } from '../simulate.ts';
import { buildTools, type Tool } from '../tools.ts';
import { VERSION } from '../version.ts';
import { clearWalkCache, findRoot, setExcludes } from './fs.ts';
import { countTokens } from './tokenize.ts';
import {
  type AgentReport,
  CATEGORIES,
  type Category,
  type LoadedItem,
  type Price,
  type Report,
  type ToolId,
} from './types.ts';
import { DEFAULT_MESSAGES, TOP_FILES, topFiles, usageFor } from './usage.ts';

export interface AnalyzeOptions {
  /** Directory the agents start in. */
  cwd: string;
  /** Repo root; default: the nearest ancestor of cwd with a .git. */
  root?: string;
  /** Tool ids to measure; default: every tool. */
  agents?: readonly ToolId[];
  /** Tools to choose from; default: the built-ins plus those in the repo's ctxsize.json. */
  tools?: readonly Tool[];
  /** Home directory to read user-level files from; omit for reproducible output. */
  home?: string;
  env?: Record<string, string | undefined>;
  contextTokens?: number;
  /** Messages for the overhead figure (default 50). */
  messages?: number;
  /** The user's price (--price). Without one no cost is computed: ctxsize has no prices of its own. */
  price?: Price | null;
  /** Which model each tool is measured with; omit to use a generic 200k-window model. */
  models?: ModelSelection;
  /** Globs (relative to the repo root) of files to leave out, as if they did not exist. */
  exclude?: readonly string[];
  /** How many of the biggest startup files each agent lists in topFiles (default 5). */
  top?: number;
  /** Run the smart checks (default true). */
  checks?: boolean;
}

export interface ModelSelection {
  models: Map<string, Model>;
  choice: ModelChoice;
}

export async function analyze(opts: AnalyzeOptions): Promise<Report> {
  const cwd = path.resolve(opts.cwd);
  clearWalkCache();
  const root = opts.root ? path.resolve(opts.root) : findRoot(cwd);
  setExcludes(root, opts.exclude ?? []);
  const env = opts.env ?? {};
  const tools = opts.tools ?? buildTools(loadConfig(root));
  const agents: AgentReport[] = [];

  for (const agent of opts.agents ?? tools.map((t) => t.id)) {
    const tool = tools.find((t) => t.id === agent);
    if (!tool) throw new Error(`unknown tool: ${agent}`);
    const picked = opts.models
      ? modelForTool(agent, opts.models.models, opts.models.choice)
      : { model: genericModel, isDefault: true };
    const { model } = picked;
    const ctx = {
      root,
      cwd,
      env,
      ...(opts.home !== undefined ? { home: opts.home } : {}),
      ...(opts.contextTokens !== undefined ? { contextTokens: opts.contextTokens } : {}),
    };
    const result = await tool.loader(ctx);
    const loaded: LoadedItem[] = result.items
      .map((item) => ({ ...item, tokens: countTokens(item.text, model.tokenizer) }))
      .sort((a, b) => a.order - b.order);
    // null: the official docs do not state this model's window. Limits that scale with the window
    // are then worked out with the generic one, and the report says the window is unknown.
    const contextTokens = opts.contextTokens ?? model.contextTokens;
    const sim = simulate({
      agent,
      items: loaded,
      contextTokens: contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      // The window is known when the user gave one or picked a model whose window is known.
      contextGiven:
        opts.contextTokens !== undefined || (!picked.isDefault && contextTokens !== null),
      count: (text: string) => countTokens(text, model.tokenizer),
      env,
      ...(tool.spec ? { spec: tool.spec } : {}),
    });
    agents.push(
      summarize(
        agent,
        tool.label,
        modelInfo(model, picked.isDefault),
        contextTokens,
        opts.messages ?? DEFAULT_MESSAGES,
        opts.price ?? null,
        sim.items,
        sim,
        result.warnings,
        opts.top ?? TOP_FILES,
      ),
    );
  }

  return {
    schemaVersion: 2,
    tool: { name: 'ctxsize', version: VERSION },
    root: '.',
    messages: opts.messages ?? DEFAULT_MESSAGES,
    price: opts.price ?? null,
    agents,
    checks:
      opts.checks === false
        ? []
        : computeChecks(agents, { descriptionLimits: skillDescriptionLimits(tools) }),
  };
}

function summarize(
  agent: ToolId,
  label: string,
  model: AgentReport['model'],
  contextTokens: number | null,
  messages: number,
  price: Price | null,
  items: LoadedItem[],
  sim: { drops: AgentReport['drops']; notes: string[] },
  warnings: AgentReport['warnings'],
  top: number,
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
    model,
    contextTokens,
    notes: sim.notes,
    startup: { total, byCategory },
    usage: usageFor(total, contextTokens, messages, price),
    topFiles: topFiles(items, top),
    onDemand: { total: onDemandTotal, count: onDemandCount },
    items,
    drops: sim.drops,
    warnings,
  };
}
