import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

// The README is also the npm page, where a relative image or link would be broken.
test('every image and link in the README is an absolute URL', () => {
  const text = read('README.md');
  const urls = [
    ...[...text.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:src|href|srcset)="([^"]+)"/g)].map((m) => m[1]),
  ];
  expect(urls.length).toBeGreaterThan(20);
  for (const url of urls) expect(url, String(url)).toMatch(/^(https:\/\/|mailto:)/);
});

test('README images come from raw.githubusercontent.com and point at files that exist', () => {
  const text = read('README.md');
  const images = [
    ...[...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]),
  ];
  // The badges are served by shields.io and GitHub Actions; every other image is ours.
  const ours = images.filter((u) => !/img.shields.io|badge.svg/.test(String(u)));
  expect(ours.length).toBeGreaterThanOrEqual(7);
  for (const url of ours) {
    const m = /^https:\/\/raw\.githubusercontent\.com\/Chiragjain7254\/ctxsize\/main\/(.+)$/.exec(
      String(url),
    );
    expect(m, String(url)).not.toBeNull();
    expect(() => readFileSync(path.join(root, m?.[1] ?? '')), String(url)).not.toThrow();
  }
  // The hero has a phone variant (light and dark), so it is readable on mobile.
  expect(text).toContain('media="(max-width: 600px)"');
  expect(text).toContain('report-mobile-dark.png');
});

test('no price is claimed: ctxsize has none, so docs and README never state a price of a model', () => {
  for (const file of ['README.md', 'docs/STUDY.md', 'docs/WHY.md']) {
    const text = read(file);
    // A money amount next to a price word ("$3 per 1M", "costs $0.05") would be a claim.
    expect(text, file).not.toMatch(
      /[$€£₹]\s?\d[\d.,]*\s*(per|\/)\s*(1\s?)?(M|K|million|thousand)/i,
    );
    expect(text, file).not.toMatch(/\bcosts? (about |roughly )?[$€£₹]\s?\d/i);
  }
});
