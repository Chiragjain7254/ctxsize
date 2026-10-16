// Runs ctxsize on a fixed list of public repositories and writes docs/study/results.json and
// docs/STUDY.md. Needs git and a built ctxsize (npm run build).
//   node scripts/study.mjs            clone every repo in docs/study/repos.json, analyse, write both files
//   node scripts/study.mjs --render   rewrite docs/STUDY.md from the existing results.json only
// Each repo is cloned shallow and sparse (agent files only) into a temp folder, then deleted.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOS = path.join(ROOT, 'docs', 'study', 'repos.json');
const RESULTS = path.join(ROOT, 'docs', 'study', 'results.json');
const STUDY_MD = path.join(ROOT, 'docs', 'STUDY.md');
const CLI = path.join(ROOT, 'dist', 'cli.mjs');

// Everything an agent reads for instructions, rules or skills, at any depth where it matters.
const SPARSE = [
  '**/CLAUDE.md',
  '**/CLAUDE.local.md',
  '**/AGENTS.md',
  '**/AGENTS.override.md',
  '**/GEMINI.md',
  '**/CONVENTIONS.md',
  '/.claude/',
  '/.agents/',
  '/.gemini/',
  '/.codex/',
  '/.cursor/',
  '/.cursorrules',
  '/.windsurf/',
  '/.windsurfrules',
  '/.devin/',
  '/.clinerules',
  '/.cline/',
  '/.opencode/',
  '/.rules',
  '/.github/copilot-instructions.md',
  '/.github/instructions/',
];

/** Tracked files that are agent files (ls-files lists every tracked file, not only the checked-out ones). */
const AGENT_FILE =
  /(^|\/)(CLAUDE|CLAUDE\.local|AGENTS|AGENTS\.override|GEMINI|CONVENTIONS)\.md$|^\.(claude|agents|gemini|codex|cursor|windsurf|devin|cline|opencode)\/|^\.(cursorrules|windsurfrules|clinerules|rules)$|^\.github\/(copilot-instructions\.md|instructions\/)/;

const git = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
  }).trim();

const today = () => new Date().toISOString().slice(0, 10);

function analyseRepo(name, tmp) {
  const dir = path.join(tmp, name.replace('/', '__'));
  git([
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--sparse',
    '--quiet',
    `https://github.com/${name}.git`,
    dir,
  ]);
  git(['sparse-checkout', 'set', '--no-cone', ...SPARSE], dir);
  const sha = git(['rev-parse', 'HEAD'], dir);
  const symlinks = materialiseSymlinks(dir);
  const out = execFileSync(process.execPath, [CLI, dir, '--all', '--json'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const report = JSON.parse(out);
  const files = git(['ls-files'], dir)
    .split('\n')
    .filter((f) => AGENT_FILE.test(f));
  return { repo: name, sha, files, symlinks, report };
}

/**
 * A symlinked agent file (typically CLAUDE.md -> AGENTS.md) is checked out as a text file holding
 * the target path when the platform cannot create symlinks, and an agent would read the target's
 * content instead. Replace such a file with a copy of its target so the study measures what the
 * agent reads. Returns the symlinks it resolved, as "link -> target".
 */
function materialiseSymlinks(dir) {
  const resolved = [];
  for (const line of git(['ls-files', '-s'], dir).split('\n')) {
    const match = /^120000 \S+ \d\t(.+)$/.exec(line);
    if (!match || !AGENT_FILE.test(match[1])) continue;
    const link = path.join(dir, ...match[1].split('/'));
    if (!existsSync(link) || !statSync(link).isFile()) continue;
    const target = path.join(path.dirname(link), readFileSync(link, 'utf8').trim());
    if (!existsSync(target) || !statSync(target).isFile() || !target.startsWith(dir)) continue;
    writeFileSync(link, readFileSync(target));
    resolved.push(`${match[1]} -> ${path.relative(dir, target).split(path.sep).join('/')}`);
  }
  return resolved;
}

/** Keeps only what the statistics and the page need. */
function summarise({ repo, sha, files, symlinks, report }) {
  return {
    repo,
    sha,
    files,
    symlinks,
    agents: report.agents.map((a) => ({
      agent: a.agent,
      label: a.label,
      startupTokens: a.startup.total,
      onDemandTokens: a.onDemand.total,
      items: a.items.map((i) => ({
        path: i.path,
        load: i.load,
        category: i.category,
        tokens: i.tokens,
        reason: i.reason,
      })),
      warnings: a.warnings.map((w) => ({ path: w.path, message: w.message })),
      drops: a.drops.map((d) => ({
        kind: d.kind,
        certainty: d.certainty,
        path: d.path,
        skill: d.skill,
        tokensLost: d.tokensLost,
      })),
    })),
    checks: report.checks.map((c) => ({
      kind: c.kind,
      code: c.code,
      tool: c.tool,
      tokens: c.tokens,
    })),
  };
}

async function collect() {
  const repos = JSON.parse(readFileSync(REPOS, 'utf8'));
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxsize-study-'));
  const results = [];
  const failed = [];
  try {
    for (const { repo } of repos) {
      try {
        results.push(summarise(analyseRepo(repo, tmp)));
        console.error(`ok   ${repo}`);
      } catch (e) {
        failed.push({ repo, error: String(e.message).split('\n')[0] });
        console.error(`FAIL ${repo}: ${String(e.message).split('\n')[0]}`);
      }
      rmSync(path.join(tmp, repo.replace('/', '__')), { recursive: true, force: true });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const data = { date: today(), ctxsizeVersion: version, results, failed };
  mkdirSync(path.dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, `${JSON.stringify(data, null, 1)}\n`);
  return data;
}

// ---- statistics -------------------------------------------------------------------------

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const fmt = (n) => n.toLocaleString('en-US');
const has = (r, re) => r.files.some((f) => re.test(f));
const agentOf = (r, id) => r.agents.find((a) => a.agent === id);

export function stats(data) {
  const rs = data.results;
  const n = rs.length;
  const both = rs.filter((r) => r.files.includes('CLAUDE.md') && r.files.includes('AGENTS.md'));
  const claudeOnly = rs.filter(
    (r) => r.files.includes('CLAUDE.md') && !r.files.includes('AGENTS.md'),
  );
  const agentsOnly = rs.filter(
    (r) => !r.files.includes('CLAUDE.md') && r.files.includes('AGENTS.md'),
  );
  const startup = (id) => rs.map((r) => agentOf(r, id)?.startupTokens ?? 0);
  const heaviest = rs.map((r) => ({
    repo: r.repo,
    tokens: Math.max(0, ...r.agents.map((a) => a.startupTokens)),
    agent: r.agents.reduce(
      (best, a) => (a.startupTokens > (best?.startupTokens ?? -1) ? a : best),
      null,
    )?.label,
  }));
  // An ignored file that is the same file on disk as one the agent reads (a symlink either way, or
  // two links to one target) is not ignored: the agent gets its content.
  const realPath = (r, p) =>
    (r.symlinks ?? []).find((l) => l.startsWith(`${p} -> `))?.split(' -> ')[1] ?? p;
  const ignoredFile = rs.filter((r) =>
    r.agents.some((a) =>
      a.items.some(
        (i) =>
          i.load === 'ignored' &&
          !a.items.some((o) => o.load !== 'ignored' && realPath(r, o.path) === realPath(r, i.path)),
      ),
    ),
  );
  const willDrop = rs.filter((r) =>
    r.agents.some((a) => a.drops.some((d) => d.certainty === 'will')),
  );
  const atRisk = rs.filter((r) =>
    r.agents.some((a) => a.drops.some((d) => d.certainty !== 'will')),
  );
  const dup = rs.filter((r) => r.checks.some((c) => c.kind === 'duplicate'));
  const withSkills = rs.filter((r) =>
    r.agents.some((a) => a.items.some((i) => i.category === 'skills')),
  );
  const noDesc = rs.filter((r) => r.checks.some((c) => c.code === 'skill-no-description'));
  const agentFileKinds = {
    'CLAUDE.md': rs.filter((r) => has(r, /(^|\/)CLAUDE\.md$/)).length,
    'AGENTS.md': rs.filter((r) => has(r, /(^|\/)AGENTS\.md$/)).length,
    'GEMINI.md': rs.filter((r) => has(r, /(^|\/)GEMINI\.md$/)).length,
    '.cursor/rules': rs.filter((r) => has(r, /^\.cursor\/rules\//)).length,
    '.github/copilot-instructions.md': rs.filter((r) =>
      r.files.includes('.github/copilot-instructions.md'),
    ).length,
    '.claude/skills or .agents/skills': rs.filter((r) => has(r, /^\.(claude|agents)\/skills\//))
      .length,
  };
  const claudeStartup = startup('claude');
  return {
    n,
    both,
    claudeOnly,
    agentsOnly,
    heaviest,
    ignoredFile,
    willDrop,
    atRisk,
    dup,
    withSkills,
    noDesc,
    agentFileKinds,
    claudeStartup,
    perAgent: ['claude', 'codex', 'cursor', 'copilot', 'gemini'].map((id) => {
      const xs = startup(id);
      return {
        id,
        label: agentOf(rs[0], id)?.label ?? id,
        median: median(xs),
        max: Math.max(0, ...xs),
        nonZero: xs.filter((x) => x > 0).length,
      };
    }),
  };
}

function render(data) {
  const s = stats(data);
  const rs = data.results;
  const top = [...s.heaviest].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  const claudeMax = Math.max(0, ...s.claudeStartup);
  const claudeMed = median(s.claudeStartup);
  const tiny = (k) => (k < 10 ? ' (a small group; read it as a hint, not a rate)' : '');
  const L = [];
  L.push('# Agent instruction files in 50 popular repos', '');
  L.push(
    `> **${pct(s.both.length, s.n)}% of ${s.n} popular repos ship both a CLAUDE.md and an AGENTS.md at the root, ${pct(s.ignoredFile.length, s.n)}% have a file some agent ignores, and the median Claude Code startup load is ${fmt(claudeMed)} tokens (largest: ${fmt(claudeMax)}).**`,
    '',
  );
  L.push(
    `Generated by \`scripts/study.mjs\` from \`docs/study/results.json\`. Do not edit by hand. Run on ${data.date} with ctxsize ${data.ctxsizeVersion}.`,
    '',
  );
  L.push('## Method', '');
  L.push(
    `Each repository below was cloned shallow and sparse (\`git clone --depth 1 --filter=blob:none --sparse\`), with only agent-related files checked out: CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/, .claude/, .agents/, .github/copilot-instructions.md and similar. ctxsize \`--all --json\` was run on each clone at the commit shown, and the clone was deleted. Nothing was run in those repositories.`,
    '',
  );
  L.push(
    '- Repositories were picked because they are well known and active, and were confirmed to contain at least one agent file. They are not a random sample, so the numbers describe these repositories only.',
    '- Because only agent files are checked out, a file pulled in with `@path` that is not itself an agent file is missing. Startup tokens can be higher for repos that import such files.',
    '- Tokens are estimates (o200k_base). "Startup" is what loads before the first prompt, per ctxsize\'s profile of each agent.',
    '- Home-directory files are not read, so user-level instructions are not counted.',
    '- A symlink between agent files (for example CLAUDE.md pointing to AGENTS.md) is replaced by a copy of its target, because an agent reads what the link points to. Such a pair is one file on disk but counts as duplicate text in the checks, and the target is not counted as ignored.',
    '',
  );
  if (data.failed.length)
    L.push(
      `Skipped because cloning or analysis failed: ${data.failed.map((f) => f.repo).join(', ')}.`,
      '',
    );
  L.push('## Headline numbers', '');
  L.push('| Measure | Repos | Share |', '| --- | --- | --- |');
  const row = (label, k) => L.push(`| ${label} | ${k} of ${s.n} | ${pct(k, s.n)}% |`);
  row('Both CLAUDE.md and AGENTS.md at the repo root', s.both.length);
  row('CLAUDE.md only (root)', s.claudeOnly.length);
  row('AGENTS.md only (root)', s.agentsOnly.length);
  row(
    'At least one file an agent ignores (e.g. AGENTS.md next to a CLAUDE.md in Claude Code)',
    s.ignoredFile.length,
  );
  row('At least one file or description an agent cuts (documented limits)', s.willDrop.length);
  row(
    'At least one item that may be cut depending on use, or is past a size recommendation',
    s.atRisk.length,
  );
  row('Duplicate instructions flagged by ctxsize checks', s.dup.length);
  L.push('');
  const cutKinds = new Map();
  for (const r of rs)
    for (const a of r.agents)
      for (const d of a.drops) {
        if (d.certainty !== 'will') continue;
        const key = `${a.label}: ${d.kind}`;
        cutKinds.set(key, (cutKinds.get(key) ?? 0) + 1);
      }
  if (cutKinds.size) {
    const list = [...cutKinds].map(([k, v]) => `${k} (${v})`).join('; ');
    L.push(`What was cut, by documented limits: ${list}.`, '');
  }
  L.push(
    `Skills: ${s.withSkills.length} of ${s.n} repos have skills that some agent lists. ${s.noDesc.length} of those ${s.withSkills.length} have at least one skill with no description${tiny(s.withSkills.length)}.`,
    '',
  );
  L.push('### Which agent files exist', '', '| File | Repos |', '| --- | --- |');
  for (const [k, v] of Object.entries(s.agentFileKinds)) L.push(`| ${k} | ${v} of ${s.n} |`);
  L.push(
    '',
    '### Startup tokens per agent',
    '',
    '| Agent | Repos where it loads anything | Median (all repos) | Max |',
    '| --- | --- | --- | --- |',
  );
  for (const a of s.perAgent)
    L.push(`| ${a.label} | ${a.nonZero} | ${fmt(a.median)} | ${fmt(a.max)} |`);
  L.push(
    '',
    'Medians include repos where the agent loads nothing (0), so they understate the load for teams that use that agent.',
    '',
  );
  L.push(
    '## Ten heaviest repos',
    '',
    '| Repo | Highest startup load | Agent |',
    '| --- | --- | --- |',
  );
  for (const t of top)
    L.push(`| [${t.repo}](https://github.com/${t.repo}) | ${fmt(t.tokens)} | ${t.agent} |`);
  L.push(
    '',
    `## The ${rs.length} repositories`,
    '',
    '| Repo | Commit | Agent files found |',
    '| --- | --- | --- |',
  );
  for (const r of rs) {
    const kinds = [
      ...new Set(
        r.files.map((f) =>
          f.split('/').pop() === 'CLAUDE.md'
            ? 'CLAUDE.md'
            : f.split('/').pop() === 'AGENTS.md'
              ? 'AGENTS.md'
              : f.split('/').pop() === 'GEMINI.md'
                ? 'GEMINI.md'
                : f.split('/')[0],
        ),
      ),
    ].sort();
    L.push(
      `| [${r.repo}](https://github.com/${r.repo}) | [\`${r.sha.slice(0, 10)}\`](https://github.com/${r.repo}/commit/${r.sha}) | ${r.files.length} files: ${kinds.join(', ')} |`,
    );
  }
  L.push('');
  return `${L.join('\n')}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(CLI)) throw new Error('dist/cli.mjs is missing; run npm run build first');
  const data = process.argv.includes('--render')
    ? JSON.parse(readFileSync(RESULTS, 'utf8'))
    : await collect();
  writeFileSync(STUDY_MD, render(data));
  console.error(`wrote docs/study/results.json (${data.results.length} repos) and docs/STUDY.md`);
}
