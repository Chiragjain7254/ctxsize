import type { AgentId, Drop, LoadedItem } from './core/types.ts';

export interface SimulateInput {
  agent: AgentId;
  items: LoadedItem[];
  contextTokens: number;
  /** True when the user passed --context, so the agent's real window is known. */
  contextGiven: boolean;
  env: Record<string, string | undefined>;
}

export interface SimulateResult {
  /** Items as the agent would see them, after truncation. */
  items: LoadedItem[];
  drops: Drop[];
  notes: string[];
}

/** Applies each agent's documented limits. Pure: no file system access. Filled in by M3. */
export function simulate(input: SimulateInput): SimulateResult {
  return { items: input.items, drops: [], notes: [] };
}
