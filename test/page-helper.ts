import path from 'node:path';
import vm from 'node:vm';
import { analyze } from '../src/core/analyze.ts';
import { AGENT_IDS } from '../src/core/types.ts';
import { type PageData, pageScript, renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';

// Helpers to look at the HTML report without a browser: build a page for a throwaway repo, and
// run the page script against a tiny fake DOM that records what is assigned to each element.

export async function report(
  files: Record<string, string>,
  sub = '',
  agents: readonly string[] = AGENT_IDS,
) {
  const root = tmpRepo({ '.git/': '', ...files });
  return analyze({ cwd: path.join(root, sub), agents: [...agents] });
}

export async function html(files: Record<string, string>, sub = '') {
  return renderHtml(await report(files, sub));
}

export function dataOf(out: string): PageData {
  const m = /<script type="application\/json" id="ctxsize-data">(.*?)<\/script>/s.exec(out);
  return JSON.parse(m?.[1] ?? 'null');
}

export interface FakeEvent {
  target: unknown;
  [key: string]: unknown;
}

export interface Page {
  /** The innerHTML last assigned to an element. */
  (id: string): string;
  /** Everything rendered, joined. */
  all(): string;
  /** Dispatches a click on the element with this data-act and data-id. */
  click(act: string, id?: string): void;
  /** Dispatches a change event (a checkbox or select). */
  change(act: string, id: string, extra?: Record<string, unknown>): void;
  /** What the page stored in localStorage. */
  storage: Map<string, string>;
  /** The address hash the page set. */
  hash(): string;
  /** Calls the page's server-sent-events handler with new data. */
  push(data: unknown): void;
}

/** Runs the page script against a fake DOM. Storage works, unless `blocked` is set. */
export function runPage(
  out: string,
  opts: { storage?: Record<string, string>; hash?: string; blocked?: boolean } = {},
): Page {
  const data = /id="ctxsize-data">(.*?)<\/script>/s.exec(out)?.[1] ?? '{}';
  const props = new Map<string, Record<string, unknown>>();
  const stub = (): unknown =>
    new Proxy(function stubTarget() {}, {
      get: (_t, k) => {
        if (k === Symbol.iterator) return function* empty() {};
        if (k === Symbol.toPrimitive) return () => '';
        if (k === 'length') return 0;
        return stub();
      },
      apply: () => stub(),
      set: () => true,
    });
  const element = (id: string) => {
    const own: Record<string, unknown> = id === 'ctxsize-data' ? { textContent: data } : {};
    props.set(id, own);
    return new Proxy(function elementTarget() {}, {
      get: (_t, k) => (typeof k === 'string' && k in own ? own[k] : stub()),
      set: (_t, k, v) => {
        own[String(k)] = v;
        return true;
      },
      apply: () => stub(),
    });
  };
  const elements = new Map<string, unknown>();
  const handlers = new Map<string, ((e: FakeEvent) => void)[]>();
  const attr = (a: Record<string, string>) => ({
    getAttribute: (k: string) => a[k] ?? null,
    closest: (sel: string) => (sel === '[data-act]' && a['data-act'] ? attr(a) : null),
  });
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    documentElement: stub(),
    head: stub(),
    activeElement: null,
    addEventListener: (type: string, fn: (e: FakeEvent) => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    querySelector: () => null,
    createElement: () => stub(),
  };
  const storage = new Map<string, string>(Object.entries(opts.storage ?? {}));
  let hash = opts.hash ?? '';
  let source: { onmessage?: (e: { data: string }) => void } = {};
  const window = {
    localStorage: opts.blocked
      ? {
          getItem: () => {
            throw new Error('blocked');
          },
          setItem: () => {
            throw new Error('blocked');
          },
        }
      : {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => {
            storage.set(k, v);
          },
        },
    location: {
      get hash() {
        return hash;
      },
    },
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        hash = url;
      },
    },
    scrollTo: () => {},
    matchMedia: () => ({ matches: false }),
    setInterval: () => 0,
    setTimeout: () => 0,
    EventSource: function EventSource() {
      source = this as typeof source;
    },
    innerWidth: 1000,
    innerHeight: 800,
  };
  vm.runInNewContext(pageScript(), { document, window, JSON, Date, Math, Number, String });
  const fire = (type: string, e: FakeEvent) => {
    for (const fn of handlers.get(type) ?? []) fn(e);
  };
  const read = ((id: string) => String(props.get(id)?.innerHTML ?? '')) as Page;
  read.all = () => [...props.values()].map((p) => String(p.innerHTML ?? '')).join('\n');
  read.click = (act, id = '') =>
    fire('click', { target: attr({ 'data-act': act, 'data-id': id }) });
  read.change = (act, id, extra = {}) =>
    fire('change', { target: { ...attr({ 'data-act': act, 'data-id': id }), ...extra } });
  read.storage = storage;
  read.hash = () => hash;
  read.push = (next) => source.onmessage?.({ data: JSON.stringify(next) });
  return read;
}
