// Writes docs/GLOSSARY.md from src/report/glossary.ts: npm run docs:glossary
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { glossaryMarkdown } from '../src/report/glossary.ts';

const file = path.join(import.meta.dirname, '..', 'docs', 'GLOSSARY.md');
writeFileSync(file, glossaryMarkdown());
console.error(`wrote ${path.relative(process.cwd(), file)}`);
