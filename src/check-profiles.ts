import type { Source } from './core/types.ts';
import { profiles, specProfiles } from './profiles.ts';

// `ctxsize --check-profiles`: every documented limit with the page it comes from and the date
// it was last checked. Offline: it only prints what profiles.ts records, so a human (or CI)
// can see what is stale and re-check it against the docs.

interface Entry {
  label: string;
  limits: [string, string | number][];
  sources: Source[];
}

function scalarLimits(profile: Record<string, unknown>): [string, string | number][] {
  const skip = new Set(['label', 'sources']);
  return Object.entries(profile).filter(
    (kv): kv is [string, string | number] =>
      !skip.has(kv[0]) && (typeof kv[1] === 'number' || typeof kv[1] === 'string'),
  );
}

export function profileEntries(): Entry[] {
  const out: Entry[] = [];
  for (const p of Object.values(profiles)) {
    out.push({ label: p.label, limits: scalarLimits(p), sources: [...p.sources] });
  }
  for (const spec of Object.values(specProfiles)) {
    out.push({
      label: spec.label,
      limits: Object.entries(spec.limits ?? {}).filter(
        (kv): kv is [string, number] => typeof kv[1] === 'number',
      ),
      sources: [...(spec.sources ?? [])],
    });
  }
  return out;
}

export function renderProfiles(): string {
  const lines = [
    'Documented limits ctxsize relies on (from src/profiles.ts), with source and check date.',
    '',
  ];
  for (const e of profileEntries()) {
    lines.push(e.label);
    if (e.limits.length === 0) lines.push('  limits: none documented');
    for (const [k, v] of e.limits) {
      lines.push(`  ${k}: ${typeof v === 'number' ? v.toLocaleString('en-US') : v}`);
    }
    for (const s of e.sources) {
      lines.push(`  source: ${s.url} (checked ${s.checked})${s.note ? `\n    ${s.note}` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}
