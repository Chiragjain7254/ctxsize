import { describe, expect, test } from 'vitest';
import { boolField, parseFrontmatter, stringField } from '../../src/core/frontmatter.ts';

describe('parseFrontmatter', () => {
  test('parses LF frontmatter', () => {
    const fm = parseFrontmatter('---\nname: deploy\n---\nBody\n');
    expect(fm.data).toEqual({ name: 'deploy' });
    expect(fm.body).toBe('Body\n');
  });

  test('parses CRLF frontmatter', () => {
    const fm = parseFrontmatter('---\r\nalwaysApply: true\r\n---\r\nBody\r\n');
    expect(fm.data).toEqual({ alwaysApply: true });
    expect(fm.body).toBe('Body\r\n');
  });

  test('folded description', () => {
    const fm = parseFrontmatter('---\ndescription: >\n  one\n  two\n---\n');
    expect(fm.data.description).toBe('one two\n');
  });

  test('no frontmatter gives empty data and full body', () => {
    expect(parseFrontmatter('# Title\n')).toEqual({ data: {}, body: '# Title\n' });
  });

  test('empty frontmatter block', () => {
    expect(parseFrontmatter('---\n\n---\nx').data).toEqual({});
  });

  test('bad YAML is an error, not a throw', () => {
    const fm = parseFrontmatter('---\nname: [unclosed\n---\nBody');
    expect(fm.error).toMatch(/invalid YAML/);
    expect(fm.error).not.toContain('\n');
    expect(fm.body).toBe('Body');
  });

  test('lenient mode reads unquoted globs that YAML rejects', () => {
    const text = '---\nglobs: *.tsx, src/**/*.ts\nalwaysApply: false\n---\nBody';
    expect(parseFrontmatter(text).error).toMatch(/invalid YAML/);
    const fm = parseFrontmatter(text, { lenient: true });
    expect(fm.error).toBeUndefined();
    expect(fm.data).toEqual({ globs: '*.tsx, src/**/*.ts', alwaysApply: false });
    expect(fm.body).toBe('Body');
  });

  test('a horizontal rule later in the file is not frontmatter', () => {
    expect(parseFrontmatter('# T\n---\nx\n---\n').data).toEqual({});
  });
});

test('stringField joins arrays and boolField accepts "true"', () => {
  expect(stringField({ globs: ['a/**', 'b/**'] }, 'globs')).toBe('a/**, b/**');
  expect(stringField({}, 'globs')).toBeUndefined();
  expect(boolField({ alwaysApply: 'true' }, 'alwaysApply')).toBe(true);
  expect(boolField({ alwaysApply: 'false' }, 'alwaysApply')).toBe(false);
});

test('stringField turns numbers and booleans into strings and ignores other values', () => {
  expect(stringField({ version: 2 }, 'version')).toBe('2');
  expect(stringField({ alwaysApply: false }, 'alwaysApply')).toBe('false');
  expect(stringField({ meta: { a: 1 } }, 'meta')).toBeUndefined();
});

test('frontmatter that is a list or a scalar is reported, not read as data', () => {
  for (const block of ['- a\n- b', 'just text']) {
    const fm = parseFrontmatter(`---\n${block}\n---\nBody`);
    expect(fm.data).toEqual({});
    expect(fm.error).toBe('frontmatter is not a YAML mapping');
    expect(fm.body).toBe('Body');
  }
});
