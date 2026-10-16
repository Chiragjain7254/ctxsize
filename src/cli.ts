#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { run } from './run.ts';

/** Questions are asked only when a person is at the terminal (never in CI or a pipe). */
const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
  cwd: process.cwd(),
  ask: interactive
    ? async (question) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          return await rl.question(question);
        } finally {
          rl.close();
        }
      }
    : undefined,
});
