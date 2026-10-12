import { countTokens, type Tokenizer } from '../core/tokenize.ts';
import type { McpServerReport, Report, ToolId } from '../core/types.ts';
import { findMcpServers, type McpServerConfig } from './config.ts';
import { listTools, type McpResult, toolDefinitionText } from './measure.ts';

export interface AttachOptions {
  /** True only with --mcp: local servers are started and asked for their tools. */
  measure: boolean;
  /** The tokenizer of the model each tool is measured with. */
  tokenizerFor: (tool: ToolId) => Tokenizer;
  /** Progress and safety notices (stderr). */
  log: (line: string) => void;
  timeoutMs?: number;
  parentEnv?: Record<string, string | undefined>;
}

/** Identity of a server for deduplication: the same command is started once for all tools. */
const keyOf = (s: McpServerConfig) =>
  JSON.stringify([s.command, s.args, Object.entries(s.env).sort(), s.cwd ?? '']);

/**
 * Adds `mcp` to every tool that has a project MCP config. Without `measure` this only reads
 * config files. With it, each distinct local server is started once, asked for `tools/list`,
 * and stopped; remote servers are never contacted.
 */
export async function attachMcp(report: Report, root: string, opts: AttachOptions): Promise<void> {
  const perAgent = report.agents.map((agent) => ({
    agent,
    found: findMcpServers(root, agent.agent),
  }));

  const results = new Map<string, McpResult>();
  if (opts.measure) {
    const toRun = new Map<string, McpServerConfig>();
    for (const { found } of perAgent) {
      for (const server of found.servers) {
        if (server.transport === 'stdio') toRun.set(keyOf(server), server);
      }
    }
    if (toRun.size > 0) {
      opts.log(
        `ctxsize --mcp: starting ${toRun.size} local MCP server(s) from this repo's config:`,
      );
      for (const s of toRun.values()) {
        opts.log(`  ${s.name}: ${[s.command, ...s.args].join(' ')}   (${s.configPath})`);
      }
    }
    for (const [key, server] of toRun) {
      results.set(
        key,
        await listTools(
          server,
          { cwd: root, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) },
          opts.parentEnv,
        ),
      );
    }
  }

  for (const { agent, found } of perAgent) {
    if (found.servers.length === 0 && found.warnings.length === 0) continue;
    const tokenizer = opts.tokenizerFor(agent.agent);
    let total = 0;
    let measured = false;
    const servers: McpServerReport[] = found.servers.map((server) => {
      const base = {
        name: server.name,
        transport: server.transport,
        configPath: server.configPath,
      };
      if (server.transport === 'remote') {
        return {
          ...base,
          status: 'remote-skipped' as const,
          message: 'remote servers are never contacted',
        };
      }
      const result = results.get(keyOf(server));
      if (!result) return { ...base, status: 'not-measured' as const };
      if (!result.ok) return { ...base, status: 'failed' as const, message: result.message };
      const tokens = result.tools.reduce(
        (sum, t) => sum + countTokens(toolDefinitionText(t), tokenizer),
        0,
      );
      total += tokens;
      measured = true;
      return { ...base, status: 'measured' as const, tools: result.tools.length, tokens };
    });
    agent.mcp = {
      servers,
      measuredTokens: measured ? total : null,
      ...(found.warnings.length > 0 ? { warnings: found.warnings } : {}),
    };
  }
}
