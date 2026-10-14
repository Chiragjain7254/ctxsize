import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Report } from './core/types.ts';
import type { Model } from './models.ts';
import { toJson } from './report/json.ts';

// --serve: the interactive HTML report on a local web server. Only node:http, only 127.0.0.1.
// Every analysis run calls update(); open pages hear about it over Server-Sent Events and swap
// in the new data without a reload.

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4321;
/** How many consecutive ports to try when the first is taken. */
export const PORT_TRIES = 10;
export const EVENTS_PATH = '/events';
const KEEPALIVE_MS = 20_000;

/** One analysis, rendered for each route. */
export interface Page {
  html: string;
  /** The body of /api/report: the same JSON as --json. */
  json: string;
  /** The page data pushed to open pages (one line of JSON). */
  event: string;
}

export interface ReportServer {
  host: string;
  port: number;
  /** What to print and open: http://localhost:<port>. */
  url: string;
  /** Serves a new page and tells every open page. */
  update(page: Page): void;
  /** Ends open event streams and stops listening. */
  close(): Promise<void>;
}

export interface ServeOptions {
  /** First port to try (default 4321). 0 asks the OS for a free port. */
  port?: number;
  /** Ports to try before giving up (default 10). */
  tries?: number;
}

/** Renders a report for the server. Loaded lazily: most runs never serve. */
export async function renderPage(report: Report, models: Map<string, Model>): Promise<Page> {
  const { renderHtml, buildPageData } = await import('./report/html.ts');
  const opts = { models, stream: EVENTS_PATH, generated: String(Date.now()) };
  return {
    html: renderHtml(report, opts),
    json: toJson(report),
    event: JSON.stringify(buildPageData(report, opts)),
  };
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Refuses requests whose Host is not this machine, so a web page cannot reach the server by DNS rebinding. */
function isLocalHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTNAMES.has(host);
}

function listenOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

export async function startReportServer(opts: ServeOptions = {}): Promise<ReportServer> {
  const first = opts.port ?? DEFAULT_PORT;
  const tries = first === 0 ? 1 : (opts.tries ?? PORT_TRIES);
  let page: Page | undefined;
  const streams = new Set<ServerResponse>();

  const send = (res: ServerResponse, status: number, type: string, body: string) => {
    res.writeHead(status, {
      'content-type': `${type}; charset=utf-8`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  };

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (!isLocalHost(req)) return send(res, 403, 'text/plain', 'Forbidden\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain', 'Method not allowed\n');
    }
    const route = (req.url ?? '/').split('?')[0];
    if (route === EVENTS_PATH) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      // The page may have loaded before the latest update: hand it the current data.
      res.write(page ? `data: ${page.event}\n\n` : ': connected\n\n');
      streams.add(res);
      res.on('close', () => streams.delete(res));
      return;
    }
    if (!page) return send(res, 503, 'text/plain', 'The first analysis is still running.\n');
    if (route === '/' || route === '/index.html') return send(res, 200, 'text/html', page.html);
    if (route === '/api/report') return send(res, 200, 'application/json', page.json);
    send(res, 404, 'text/plain', 'Not found\n');
  };

  let server: Server | undefined;
  let lastError: unknown;
  for (let i = 0; i < tries && first + i <= 65535; i++) {
    const candidate = createServer(handler);
    try {
      await listenOnce(candidate, first + i);
      server = candidate;
      break;
    } catch (err) {
      lastError = err;
      candidate.close();
      const code = (err as NodeJS.ErrnoException).code;
      // Taken, or on Windows reserved: try the next port. Anything else is a real failure.
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
    }
  }
  if (!server) {
    if (tries <= 1) throw lastError;
    throw new Error(
      `ports ${first} to ${first + tries - 1} are all in use; pass --port <n> to choose another`,
    );
  }

  const live = server;
  const bound = live.address() as AddressInfo;
  const keepalive = setInterval(() => {
    for (const res of streams) res.write(': ping\n\n');
  }, KEEPALIVE_MS);
  keepalive.unref();

  return {
    host: HOST,
    port: bound.port,
    url: `http://localhost:${bound.port}`,
    update(next) {
      page = next;
      for (const res of streams) res.write(`data: ${next.event}\n\n`);
    },
    close() {
      clearInterval(keepalive);
      return new Promise((resolve) => {
        live.close(() => resolve());
        for (const res of streams) res.end();
        streams.clear();
        live.closeAllConnections();
      });
    },
  };
}
