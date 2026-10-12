import { loaders } from './agents/index.ts';
import { specLoader } from './agents/spec.ts';
import { type Config, ConfigError } from './config.ts';
import type { Loader, Source, ToolId, ToolSpec } from './core/types.ts';
import { DEFAULT_CONTEXT_TOKENS, profiles, specProfiles } from './profiles.ts';

/** One tool ctxsize can measure: built in, or defined in ctxsize.json. */
export interface Tool {
  id: ToolId;
  label: string;
  defaultContextTokens: number;
  loader: Loader;
  /** Set for tools described as data; the simulator reads its limits. */
  spec?: ToolSpec;
  sources: Source[];
  origin: 'built-in' | 'config';
}

/** Built-in tools first (hand-written, then data-driven), then tools only the config defines. */
export function buildTools(config?: Config): Tool[] {
  const tools: Tool[] = [];
  for (const [id, loader] of Object.entries(loaders)) {
    const profile = profiles[id as keyof typeof profiles];
    tools.push({
      id,
      label: profile.label,
      defaultContextTokens: profile.defaultContextTokens,
      loader,
      sources: [...profile.sources],
      origin: 'built-in',
    });
  }

  const specs = new Map<ToolId, { spec: ToolSpec; origin: Tool['origin'] }>();
  for (const [id, spec] of Object.entries(specProfiles))
    specs.set(id, { spec, origin: 'built-in' });

  for (const [id, user] of Object.entries(config?.tools ?? {})) {
    const where = `${config?.origin ?? 'config'}: tools.${id}`;
    const { model: _model, ...fields } = user;
    if (id in loaders) {
      if (Object.keys(fields).length > 0) {
        throw new ConfigError(
          `${where}: "${id}" is a built-in tool with its own loader; only "model" can be set. Use another id to define a new tool`,
        );
      }
      continue;
    }
    const base = specs.get(id);
    const merged = { ...(base?.spec ?? {}), ...fields } as Partial<ToolSpec>;
    if (!merged.label) throw new ConfigError(`${where}: "label" is required for a new tool`);
    if (!merged.instructions && !merged.rules && !merged.skills) {
      throw new ConfigError(`${where}: define at least one of "instructions", "rules" or "skills"`);
    }
    specs.set(id, { spec: merged as ToolSpec, origin: base ? base.origin : 'config' });
  }

  for (const [id, { spec, origin }] of specs) {
    tools.push({
      id,
      label: spec.label,
      defaultContextTokens: spec.defaultContextTokens ?? DEFAULT_CONTEXT_TOKENS,
      loader: specLoader(id, spec),
      spec,
      sources: spec.sources ?? [],
      origin,
    });
  }
  return tools;
}
