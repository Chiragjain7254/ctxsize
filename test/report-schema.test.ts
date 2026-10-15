// docs/report.schema.json must describe what `ctxsize --json` really prints.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { EXIT, run } from '../src/run.ts';
import { tmpRepo } from './helpers.ts';

const schema = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'docs', 'report.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
// date-time is the only format the schema uses; a plain ISO check is enough here.
ajv.addFormat('date-time', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
const validate = ajv.compile(schema);

async function json(argv: string[], cwd: string) {
  let stdout = '';
  const code = await run(['--json', ...argv], {
    stdout: (t) => {
      stdout += t;
    },
    stderr: () => {},
    env: {},
    isTTY: false,
    cwd,
  });
  expect(code).toBe(EXIT.ok);
  return JSON.parse(stdout);
}

const check = (report: unknown) => {
  const ok = validate(report);
  expect(ok, JSON.stringify(validate.errors, null, 1)).toBe(true);
};

const files = {
  '.git/': '',
  'CLAUDE.md': '# Claude\n\nSee @docs/style.md\n',
  'docs/style.md': '# Style\n',
  'AGENTS.md': `# Agents\n\n${'Run the tests before every commit. '.repeat(40)}\n`,
  'packages/app/AGENTS.md': '# App\n',
  '.claude/rules/ts.md': '---\npaths: src/**/*.ts\n---\nStrict mode.\n',
  '.claude/skills/x/SKILL.md': '---\nname: x\ndescription: Does x. Use when x.\n---\nBody\n',
  '.cursor/rules/a.mdc': '---\nalwaysApply: true\n---\nBe kind.\n',
  '.cursorrules': 'legacy rules\n',
  '.mcp.json': '{"mcpServers":{"demo":{"command":"node","args":["x.js"]}}}',
  'ctxsize.json': '{"tools":{"acme":{"label":"Acme","instructions":["ACME.md"]}}}',
  'ACME.md': 'Acme rules.\n',
};

describe('docs/report.schema.json', () => {
  test('is a valid JSON Schema', () => {
    expect(new Ajv2020({ strict: false }).validateSchema(schema)).toBe(true);
  });

  test('accepts the report for a typical repo', async () => {
    check(await json([], tmpRepo(files)));
  });

  test('accepts every tool, hidden tools and --tree', async () => {
    const report = await json(['--all', '--tree'], tmpRepo(files));
    check(report);
    expect(report.tree.length).toBeGreaterThan(1);
  });

  test('accepts an empty repo', async () => {
    check(await json([], tmpRepo({ '.git/': '' })));
  });

  test('accepts drops: a cut file and a legacy file', async () => {
    const report = await json(
      ['--agents', 'codex,cursor'],
      tmpRepo({ ...files, 'AGENTS.md': 'x '.repeat(20000) }),
    );
    check(report);
    const kinds = report.agents.flatMap((a: { drops: { kind: string }[] }) =>
      a.drops.map((d) => d.kind),
    );
    expect(kinds).toEqual(expect.arrayContaining(['file-truncated', 'legacy']));
  });

  test('accepts --mcp not measured servers', async () => {
    const report = await json(['--agents', 'claude'], tmpRepo(files));
    check(report);
    expect(report.agents[0].mcp.servers[0].status).toBe('not-measured');
  });

  test('rejects a report that is missing generatedAt or has a wrong type', async () => {
    const report = await json([], tmpRepo(files));
    const { generatedAt: _g, ...without } = report;
    expect(validate(without)).toBe(false);
    expect(validate({ ...report, messages: 'many' })).toBe(false);
    expect(validate({ ...report, surprise: true })).toBe(false);
  });
});
