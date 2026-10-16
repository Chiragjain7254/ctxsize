import { countTokens } from './core/tokenize.ts';
import type { Drop, LoadedItem, ToolId, ToolSpec } from './core/types.ts';
import { profiles } from './profiles.ts';

/** Counts tokens the way the tool's model would; set per simulate() call. */
let count: (text: string) => number = (text) => countTokens(text);

export interface SimulateInput {
  agent: ToolId;
  items: LoadedItem[];
  contextTokens: number;
  /** True when the user passed --context, so the agent's real window is known. */
  contextGiven: boolean;
  env: Record<string, string | undefined>;
  /** For tools described as data: their limits are applied after the per-agent rules. */
  spec?: ToolSpec;
  /** Token counter for the tool's model; default o200k_base. */
  count?: (text: string) => number;
}

export interface SimulateResult {
  /** Items as the agent would see them, after truncation. */
  items: LoadedItem[];
  drops: Drop[];
  notes: string[];
}

/**
 * Applies each agent's documented limits to the items its loader found. Pure: no file
 * system access. Only `will` drops change the items; `at-risk` and `advice` only report.
 */
export function simulate(input: SimulateInput): SimulateResult {
  // simulate() is synchronous, so a module-level counter cannot leak between calls.
  count = input.count ?? ((text) => countTokens(text));
  const result: SimulateResult = {
    items: input.items.map((i) => ({ ...i })),
    drops: [],
    notes: [],
  };
  switch (input.agent) {
    case 'claude':
      claudeSkills(input, result);
      claudeMemory(result);
      break;
    case 'codex':
      codexInstructions(result);
      codexSkills(input, result);
      break;
    case 'cursor':
      cursorRules(result);
      break;
    case 'copilot':
      result.notes.push(
        `Modelled surface: ${profiles.copilot.surface}. Other Copilot surfaces load different files.`,
      );
      break;
    case 'gemini':
      break;
  }
  if (input.spec) specLimits(input.agent, input.spec, result);
  if (input.spec?.notes) result.notes.push(...input.spec.notes);
  return result;
}

// ---------------------------------------------------------------- helpers

const startup = (items: LoadedItem[], category: LoadedItem['category']) =>
  items.filter((i) => i.load === 'startup' && i.category === category);

/** Cuts text to at most maxBytes of UTF-8 without leaving half a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  // Step back over UTF-8 continuation bytes (10xxxxxx) so no character is split.
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

/** Replaces an item's text and refreshes its byte and token counts. */
function setText(item: LoadedItem, text: string): { bytesLost: number; tokensLost: number } {
  const before = { bytes: item.bytes, tokens: item.tokens };
  item.text = text;
  item.bytes = Buffer.byteLength(text, 'utf8');
  item.tokens = count(text);
  return { bytesLost: before.bytes - item.bytes, tokensLost: before.tokens - item.tokens };
}

function dropItem(item: LoadedItem, why: string): { bytesLost: number; tokensLost: number } {
  const lost = { bytesLost: item.bytes, tokensLost: item.tokens };
  item.load = 'ignored';
  item.reason = `${item.reason} (dropped: ${why})`;
  return lost;
}

const fmt = (n: number) => n.toLocaleString('en-US');

function skillEntry(name: string, description: string): string {
  return description ? `- ${name}: ${description}\n` : `- ${name}\n`;
}

// ---------------------------------------------------------------- Claude Code

function claudeSkills(input: SimulateInput, result: SimulateResult): void {
  const p = profiles.claude;
  const skills = startup(result.items, 'skills').filter((i) => i.skill);

  // Each entry's description + when_to_use is capped, regardless of the overall budget.
  for (const item of skills) {
    const info = item.skill;
    if (!info) continue;
    const combined = [info.description, info.whenToUse].filter(Boolean).join(' ');
    if (combined.length <= p.skillListingMaxDescChars) continue;
    const lost = setText(
      item,
      skillEntry(info.name, combined.slice(0, p.skillListingMaxDescChars)),
    );
    result.drops.push({
      agent: 'claude',
      kind: 'skill-description-truncated',
      certainty: 'will',
      path: item.path,
      skill: info.name,
      ...lost,
      limit: 'claude.skillListingMaxDescChars',
    });
  }
  if (skills.length === 0) return;

  // The whole listing has a budget; past it, descriptions of the least-used skills are
  // dropped. Usage is invisible to a static tool, so every description is at risk.
  const charBudget = Number(input.env[p.skillListingCharBudgetEnv]);
  const useChars = Number.isFinite(charBudget) && charBudget > 0;
  const budget = useChars
    ? charBudget
    : Math.floor(input.contextTokens * p.skillListingBudgetFraction);
  const size = (i: LoadedItem) => (useChars ? i.text.length : i.tokens);
  const nameOnly = (i: LoadedItem) => {
    const entry = skillEntry(i.skill?.name ?? '', '');
    return useChars ? entry.length : count(entry);
  };
  const used = skills.reduce((sum, i) => sum + size(i), 0);
  if (used <= budget) return;

  // Fewest descriptions that must go: drop the largest savings first.
  const savings = skills.map((i) => size(i) - nameOnly(i)).sort((a, b) => b - a);
  let over = used - budget;
  let k = 0;
  while (over > 0 && k < savings.length) over -= savings[k++] ?? 0;

  const unit = useChars ? 'chars' : 'tokens';
  const source = useChars
    ? `${p.skillListingCharBudgetEnv}=${fmt(budget)}`
    : `${p.skillListingBudgetFraction * 100}% of ${fmt(input.contextTokens)} context`;
  result.notes.push(
    `Skill listing is ${fmt(used)} ${unit}, over its budget of ${fmt(budget)} ${unit} (${source}). ` +
      `At least ${k} of ${skills.length} skill descriptions will be dropped, least-used first; ` +
      'names stay listed.',
  );
  for (const item of skills) {
    const descTokens = item.tokens - count(skillEntry(item.skill?.name ?? '', ''));
    result.drops.push({
      agent: 'claude',
      kind: 'skill-description-dropped',
      certainty: 'at-risk',
      path: item.path,
      skill: item.skill?.name ?? item.path,
      tokensLost: Math.max(0, descTokens),
      limit: useChars ? 'claude.skillListingCharBudgetEnv' : 'claude.skillListingBudgetFraction',
    });
  }
}

function claudeMemory(result: SimulateResult): void {
  const p = profiles.claude;
  for (const item of startup(result.items, 'memory')) {
    const lines = item.text.split('\n');
    let text = item.text;
    if (lines.length > p.memoryMaxLines) text = lines.slice(0, p.memoryMaxLines).join('\n');
    text = truncateUtf8(text, p.memoryMaxBytes);
    if (text === item.text) continue;
    const lost = setText(item, text);
    result.drops.push({
      agent: 'claude',
      kind: 'file-truncated',
      certainty: 'will',
      path: item.path,
      ...lost,
      limit: lines.length > p.memoryMaxLines ? 'claude.memoryMaxLines' : 'claude.memoryMaxBytes',
    });
  }
}

// ---------------------------------------------------------------- Codex

function codexInstructions(result: SimulateResult): void {
  // Files load root to cwd; the one that crosses the limit is cut, later ones are not read.
  // Only project docs share the budget; the global ~/.codex file is carried separately.
  let remaining: number = profiles.codex.projectDocMaxBytes;
  const limitLabel = `over ${remaining / 1024} KiB of AGENTS.md`;
  for (const item of startup(result.items, 'instructions')) {
    if (item.scope !== 'project') continue;
    if (remaining <= 0) {
      const lost = dropItem(item, limitLabel);
      result.drops.push({
        agent: 'codex',
        kind: 'file-dropped',
        certainty: 'will',
        path: item.path,
        ...lost,
        limit: 'codex.projectDocMaxBytes',
      });
      continue;
    }
    if (item.bytes > remaining) {
      const lost = setText(item, truncateUtf8(item.text, remaining));
      result.drops.push({
        agent: 'codex',
        kind: 'file-truncated',
        certainty: 'will',
        path: item.path,
        ...lost,
        limit: 'codex.projectDocMaxBytes',
      });
    }
    remaining -= item.bytes;
  }
}

function codexSkills(input: SimulateInput, result: SimulateResult): void {
  const p = profiles.codex;
  const skills = startup(result.items, 'skills').filter((i) => i.skill);
  if (skills.length === 0) return;

  // 2% of the context window, or a fixed character budget when the window is unknown.
  const useChars = !input.contextGiven;
  const budget = useChars
    ? p.skillListingFallbackChars
    : Math.floor(input.contextTokens * p.skillListingBudgetFraction);
  const measure = (text: string) => (useChars ? text.length : count(text));
  const unit = useChars ? 'chars' : 'tokens';
  const used = skills.reduce((sum, i) => sum + measure(i.text), 0);
  if (useChars) {
    result.notes.push(
      `Skill listing budget: ${fmt(budget)} chars (context window unknown; pass --context for 2%).`,
    );
  }
  if (used <= budget) return;

  // Shorten descriptions first: give every skill an equal share of what is left after names.
  const names = skills.map((i) => measure(skillEntry(i.skill?.name ?? '', '')));
  const namesTotal = names.reduce((a, b) => a + b, 0);
  if (namesTotal <= budget) {
    const share = Math.floor((budget - namesTotal) / skills.length);
    for (const [i, item] of skills.entries()) {
      const info = item.skill;
      if (!info) continue;
      const max = (names[i] ?? 0) + share;
      const desc = shortenTo(info.description, (d) => measure(skillEntry(info.name, d)) <= max);
      if (desc === info.description) continue;
      const lost = setText(item, skillEntry(info.name, desc));
      result.drops.push({
        agent: 'codex',
        kind: 'skill-description-truncated',
        certainty: useChars ? 'at-risk' : 'will',
        path: item.path,
        skill: info.name,
        ...lost,
        limit: useChars ? 'codex.skillListingFallbackChars' : 'codex.skillListingBudgetFraction',
      });
    }
    result.notes.push(
      `Skill listing is ${fmt(used)} ${unit}, over its ${fmt(budget)} ${unit} budget: ` +
        'descriptions are shortened (estimated as an equal share each).',
    );
    return;
  }

  // Still over with names alone: skills are left out, from the end of discovery order.
  let total = namesTotal;
  let omitted = 0;
  for (let i = skills.length - 1; i >= 0 && total > budget; i--) {
    const item = skills[i];
    if (!item) continue;
    total -= names[i] ?? 0;
    omitted++;
    const lost = dropItem(item, 'skill listing over budget');
    result.drops.push({
      agent: 'codex',
      kind: 'skill-omitted',
      certainty: useChars ? 'at-risk' : 'will',
      path: item.path,
      skill: item.skill?.name ?? item.path,
      ...lost,
      limit: useChars ? 'codex.skillListingFallbackChars' : 'codex.skillListingBudgetFraction',
    });
  }
  for (const item of skills) {
    if (item.load === 'startup' && item.skill) setText(item, skillEntry(item.skill.name, ''));
  }
  result.notes.push(
    `Skill listing is ${fmt(used)} ${unit}, over its ${fmt(budget)} ${unit} budget even without ` +
      `descriptions: ${omitted} of ${skills.length} skills are left out.`,
  );
}

/** Longest prefix of text (plus "...") that fits; '' when even one character does not. */
function shortenTo(text: string, fits: (t: string) => boolean): string {
  if (fits(text)) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(`${text.slice(0, mid)}...`)) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : `${text.slice(0, lo)}...`;
}

// ---------------------------------------------------------------- Cursor

function cursorRules(result: SimulateResult): void {
  const max = profiles.cursor.ruleRecommendedMaxLines;
  for (const item of result.items) {
    if (item.category !== 'rules' || item.load === 'ignored') continue;
    if (item.reason.startsWith('legacy')) {
      result.drops.push({
        agent: 'cursor',
        kind: 'legacy',
        certainty: 'at-risk',
        path: item.path,
        tokensLost: item.tokens,
        limit: 'cursor.sources',
      });
    }
    const lines = item.text.split('\n').length - (item.text.endsWith('\n') ? 1 : 0);
    if (lines > max) {
      result.drops.push({
        agent: 'cursor',
        kind: 'over-recommended-size',
        certainty: 'advice',
        path: item.path,
        limit: 'cursor.ruleRecommendedMaxLines',
      });
    }
  }
}

// ---------------------------------------------------------------- Tools described as data

function specLimits(id: ToolId, spec: ToolSpec, result: SimulateResult): void {
  const limits = spec.limits;
  if (!limits) return;

  if (limits.maxFileBytes !== undefined) {
    for (const item of startup(result.items, 'instructions').concat(
      startup(result.items, 'rules'),
    )) {
      if (item.bytes <= limits.maxFileBytes) continue;
      const lost = setText(item, truncateUtf8(item.text, limits.maxFileBytes));
      result.drops.push({
        agent: id,
        kind: 'file-truncated',
        certainty: 'will',
        path: item.path,
        ...lost,
        limit: `${id}.maxFileBytes`,
      });
    }
  }

  if (limits.maxTotalBytes !== undefined) {
    let remaining = limits.maxTotalBytes;
    for (const item of startup(result.items, 'instructions')) {
      if (remaining <= 0) {
        const lost = dropItem(item, `over ${fmt(limits.maxTotalBytes)} bytes of instructions`);
        result.drops.push({
          agent: id,
          kind: 'file-dropped',
          certainty: 'will',
          path: item.path,
          ...lost,
          limit: `${id}.maxTotalBytes`,
        });
        continue;
      }
      if (item.bytes > remaining) {
        const lost = setText(item, truncateUtf8(item.text, remaining));
        result.drops.push({
          agent: id,
          kind: 'file-truncated',
          certainty: 'will',
          path: item.path,
          ...lost,
          limit: `${id}.maxTotalBytes`,
        });
      }
      remaining -= item.bytes;
    }
  }

  if (limits.maxFileChars !== undefined) {
    // The docs give a size but not what happens past it, so this is reported, not applied.
    for (const item of startup(result.items, 'rules')) {
      if ([...item.text].length <= limits.maxFileChars) continue;
      result.drops.push({
        agent: id,
        kind: 'over-recommended-size',
        certainty: 'at-risk',
        path: item.path,
        limit: `${id}.maxFileChars`,
      });
    }
  }

  if (limits.recommendedMaxLines !== undefined) {
    for (const item of startup(result.items, 'rules').concat(
      startup(result.items, 'instructions'),
    )) {
      const lines = item.text.split('\n').length - (item.text.endsWith('\n') ? 1 : 0);
      if (lines <= limits.recommendedMaxLines) continue;
      result.drops.push({
        agent: id,
        kind: 'over-recommended-size',
        certainty: 'advice',
        path: item.path,
        limit: `${id}.recommendedMaxLines`,
      });
    }
  }

  if (limits.skillDescriptionMaxChars !== undefined) {
    for (const item of startup(result.items, 'skills')) {
      if (!item.skill || [...item.skill.description].length <= limits.skillDescriptionMaxChars)
        continue;
      result.drops.push({
        agent: id,
        kind: 'skill-description-truncated',
        certainty: 'at-risk',
        path: item.path,
        skill: item.skill.name,
        limit: `${id}.skillDescriptionMaxChars`,
      });
    }
  }

  if (limits.skillListingMaxBytes !== undefined) {
    let remaining = limits.skillListingMaxBytes;
    for (const item of startup(result.items, 'skills')) {
      if (item.bytes <= remaining) {
        remaining -= item.bytes;
        continue;
      }
      remaining = 0;
      const lost = dropItem(
        item,
        `over ${fmt(limits.skillListingMaxBytes)} bytes of skill listing`,
      );
      result.drops.push({
        agent: id,
        kind: 'skill-omitted',
        certainty: 'will',
        path: item.path,
        ...(item.skill ? { skill: item.skill.name } : {}),
        ...lost,
        limit: `${id}.skillListingMaxBytes`,
      });
    }
  }
}
