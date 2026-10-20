import path from 'node:path';
import { fileExists, readText, toPosixRel } from '../core/fs.ts';
import type { Source, ToolId } from '../core/types.ts';

// Finds the MCP servers a repo configures for each tool. Reading config files is always
// safe; starting the servers (src/mcp/measure.ts) only happens with --mcp.

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'remote';
  command?: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url?: string;
  /** POSIX path of the config file, relative to the repo root. */
  configPath: string;
}

interface McpLocation {
  /** File relative to the repo root, tried in order; the first that exists is used. */
  files: string[];
  format: 'json' | 'toml';
  /** Key holding the servers: "mcpServers", "servers", "mcp". */
  key: string;
  sources: Source[];
}

const CHECKED = '2026-10-13';

/** Where each tool's project-level MCP servers live. Tools not listed have no documented project file. */
export const MCP_LOCATIONS: Record<ToolId, McpLocation> = {
  claude: {
    files: ['.mcp.json'],
    format: 'json',
    key: 'mcpServers',
    sources: [
      {
        url: 'https://code.claude.com/docs/en/mcp',
        checked: CHECKED,
        note: 'Project scope: .mcp.json at the repo root; Claude Code uses tool search by default',
      },
    ],
  },
  cursor: {
    files: ['.cursor/mcp.json'],
    format: 'json',
    key: 'mcpServers',
    sources: [{ url: 'https://cursor.com/docs/context/mcp', checked: CHECKED }],
  },
  copilot: {
    files: ['.vscode/mcp.json'],
    format: 'json',
    key: 'servers',
    sources: [
      {
        url: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
        checked: CHECKED,
        note: 'VS Code workspace file; the cloud agent configures MCP in repository settings instead',
      },
    ],
  },
  gemini: {
    files: ['.gemini/settings.json'],
    format: 'json',
    key: 'mcpServers',
    sources: [{ url: 'https://geminicli.com/docs/tools/mcp-server/', checked: CHECKED }],
  },
  codex: {
    files: ['.codex/config.toml'],
    format: 'toml',
    key: 'mcp_servers',
    sources: [
      {
        url: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
        checked: CHECKED,
        note: 'Project-scoped .codex/config.toml applies to trusted projects only',
      },
    ],
  },
  opencode: {
    files: ['opencode.json', 'opencode.jsonc'],
    format: 'json',
    key: 'mcp',
    sources: [{ url: 'https://opencode.ai/docs/mcp-servers/', checked: CHECKED }],
  },
};

export interface McpFound {
  servers: McpServerConfig[];
  /** Problems reading a config file, e.g. invalid JSON. */
  warnings: string[];
}

export function findMcpServers(root: string, toolId: ToolId): McpFound {
  const location = MCP_LOCATIONS[toolId];
  const found: McpFound = { servers: [], warnings: [] };
  if (!location) return found;
  for (const rel of location.files) {
    const abs = path.join(root, ...rel.split('/'));
    if (!fileExists(path.dirname(abs), path.basename(abs))) continue;
    const text = readText(abs);
    if (text === undefined) continue;
    const configPath = toPosixRel(root, abs);
    try {
      const raw =
        location.format === 'toml'
          ? parseCodexToml(text, location.key)
          : pickJson(parseJsonc(text), location.key);
      for (const [name, value] of Object.entries(raw)) {
        const server = toServer(name, value, configPath);
        if (server) found.servers.push(server);
      }
    } catch (err) {
      found.warnings.push(`${configPath}: ${(err as Error).message}`);
    }
    break;
  }
  return found;
}

function pickJson(doc: unknown, key: string): Record<string, unknown> {
  if (!isObject(doc)) return {};
  const servers = doc[key];
  return isObject(servers) ? servers : {};
}

function toServer(name: string, value: unknown, configPath: string): McpServerConfig | undefined {
  if (!isObject(value) || value.enabled === false) return undefined;
  const url = str(value.url) ?? str(value.httpUrl);
  // OpenCode writes the command as one array; the others split command and args.
  const commandArray = Array.isArray(value.command) ? value.command.map(String) : undefined;
  const command = commandArray ? commandArray[0] : str(value.command);
  const args = commandArray
    ? commandArray.slice(1)
    : Array.isArray(value.args)
      ? value.args.map(String)
      : [];
  const envSource = isObject(value.env)
    ? value.env
    : isObject(value.environment)
      ? value.environment
      : {};
  const env = Object.fromEntries(Object.entries(envSource).map(([k, v]) => [k, String(v)]));
  const cwd = str(value.cwd);
  if (command && !url) {
    return { name, transport: 'stdio', command, args, env, ...(cwd ? { cwd } : {}), configPath };
  }
  if (url) return { name, transport: 'remote', args: [], env: {}, url, configPath };
  return undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

// ---------------------------------------------------------------- JSON with comments

/** JSON.parse that also accepts // and /* *\/ comments and trailing commas (settings files). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/^\uFEFF/, '').replace(/,(\s*[}\]])/g, '$1'));
}

// ---------------------------------------------------------------- Minimal TOML for Codex

/**
 * Reads only the `[mcp_servers.<name>]` tables (and `[mcp_servers.<name>.env]`) that Codex
 * documents: string, string-array and inline-table values. Anything else is ignored, so an
 * unusual config file never throws just because it uses other TOML features.
 */
export function parseCodexToml(text: string, tableName: string): Record<string, unknown> {
  const servers: Record<string, Record<string, unknown>> = {};
  let current: Record<string, unknown> | undefined;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = stripTomlComment(lines[i] ?? '').trim();
    if (line === '') continue;
    const header = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (header) {
      current = undefined;
      const parts = splitTomlKey(header[1] ?? '');
      if (parts[0] !== tableName || parts.length < 2) continue;
      const name = parts[1] ?? '';
      const server = servers[name] ?? {};
      servers[name] = server;
      if (parts.length === 2) {
        current = server;
      } else if (parts.length === 3 && parts[2] === 'env') {
        const env: Record<string, unknown> = {};
        server.env = env;
        current = env;
      }
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = unquote(line.slice(0, eq).trim());
    let value = line.slice(eq + 1).trim();
    // A multi-line array continues until its closing bracket.
    while (value.startsWith('[') && !balanced(value) && i + 1 < lines.length) {
      value += ` ${stripTomlComment(lines[++i] ?? '').trim()}`;
    }
    current[key] = parseTomlValue(value);
  }
  return servers;
}

function stripTomlComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function splitTomlKey(key: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|([A-Za-z0-9_-]+)/g;
  for (const m of key.matchAll(re)) parts.push(m[1] ?? m[2] ?? m[3] ?? '');
  return parts;
}

const unquote = (s: string) => (/^["'].*["']$/.test(s) ? s.slice(1, -1) : s);

function balanced(value: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? '';
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') depth--;
  }
  return depth <= 0;
}

function parseTomlValue(value: string): unknown {
  if (value.startsWith('[')) {
    return [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) =>
      m[1] !== undefined ? unescapeToml(m[1]) : (m[2] ?? ''),
    );
  }
  if (value.startsWith('{')) {
    const table: Record<string, string> = {};
    for (const m of value.matchAll(
      /([A-Za-z0-9_-]+|"[^"]*")\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g,
    )) {
      table[unquote(m[1] ?? '')] = m[2] !== undefined ? unescapeToml(m[2]) : (m[3] ?? '');
    }
    return table;
  }
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value) ?? undefined;
  if (quoted) return unescapeToml(quoted[1] ?? '');
  const literal = /^'([^']*)'$/.exec(value);
  if (literal) return literal[1];
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

const unescapeToml = (s: string) =>
  s.replace(
    /\\(["\\ntr])/g,
    (_, c: string) => ({ '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' })[c] ?? c,
  );
