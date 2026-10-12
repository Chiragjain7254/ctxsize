import type { AgentId, Loader } from '../core/types.ts';
import { load as claude } from './claude.ts';
import { load as codex } from './codex.ts';
import { load as copilot } from './copilot.ts';
import { load as cursor } from './cursor.ts';
import { load as gemini } from './gemini.ts';

export const loaders: Record<AgentId, Loader> = { claude, codex, cursor, copilot, gemini };
