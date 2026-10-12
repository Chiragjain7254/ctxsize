// A minimal MCP server over stdio for tests. FAKE_MARKER: file that gets one line per start.
// FAKE_MODE: "normal" (default), "hang" (never answers), "crash" (exits immediately),
// "noisy" (logs non-JSON lines to stdout first), "pages" (tools/list in two pages).
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

if (process.env.FAKE_MARKER) appendFileSync(process.env.FAKE_MARKER, `started ${process.pid}\n`);
const mode = process.env.FAKE_MODE ?? 'normal';
if (mode === 'crash') process.exit(3);
if (mode === 'noisy') console.log('server booting, not json');

const tool = (n) => ({
  name: `tool_${n}`,
  description: `Does thing number ${n} with the given path and options.`,
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
});

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (mode === 'hang') return;
  const msg = JSON.parse(line);
  const reply = (result) => console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  if (msg.method === 'initialize') {
    reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
  } else if (msg.method === 'tools/list') {
    if (mode === 'pages') {
      if (msg.params?.cursor === 'p2') reply({ tools: [tool(3)] });
      else reply({ tools: [tool(1), tool(2)], nextCursor: 'p2' });
    } else {
      reply({ tools: [tool(1), tool(2)] });
    }
  }
});
rl.on('close', () => process.exit(0));
