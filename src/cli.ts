#!/usr/bin/env node
import { VERSION } from './version.ts';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
} else {
  console.log(`ctxsize ${VERSION}`);
}
