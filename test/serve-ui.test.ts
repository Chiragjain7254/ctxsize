// The live parts of the --serve page (status dot, last updated, toast), run against a fake DOM.
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
import { analyze } from '../src/core/analyze.ts';
import { pageScript, renderHtml } from '../src/report/html.ts';
import { tmpRepo } from './helpers.ts';

interface Source {
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: (e: { data: string }) => void;
}

/** Loads the page the way --serve would serve it, with a controllable clock and event stream. */
async function load(opts: { stream?: boolean; watch?: boolean } = { stream: true }) {
  const root = tmpRepo({ '.git/': '', 'AGENTS.md': '# Agents\n\nRun the tests.\n' });
  const report = await analyze({ cwd: path.join(root), agents: ['codex'] });
  const out = renderHtml(report, {
    generated: '1',
    ...(opts.stream ? { stream: '/events' } : {}),
    ...(opts.watch ? { watch: { file: 'r.data.js' } } : {}),
  });
  const data = /id="ctxsize-data">(.*?)<\/script>/s.exec(out)?.[1] ?? '{}';
  const props = new Map<string, Record<string, unknown>>();
  const timers: { fn: () => void; ms: number }[] = [];
  const sources: Source[] = [];
  let clock = 1;

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
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    documentElement: stub(),
    head: stub(),
    activeElement: null,
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => stub(),
  };
  class FakeEventSource {
    constructor(public url: string) {
      sources.push(this as unknown as Source);
    }
  }
  const window = {
    localStorage: {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    },
    matchMedia: () => ({ matches: false }),
    setInterval: () => 0,
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    EventSource: FakeEventSource,
    innerWidth: 1000,
    innerHeight: 800,
  };
  class FakeDate extends Date {
    private readonly at = clock;
    override toLocaleTimeString(): string {
      return `t${this.at}`;
    }
  }
  vm.runInNewContext(pageScript(), {
    document,
    window,
    JSON,
    Date: FakeDate,
    Math,
    Number,
    String,
  });
  const el = (id: string) => props.get(id) ?? {};
  return {
    el,
    source: sources[0] as Source,
    timers,
    tick: (to: number) => {
      clock = to;
    },
    /** A new report arrives over the event stream. */
    push: (generated: string) => {
      const next = { ...JSON.parse(data), generated };
      sources[0]?.onmessage?.({ data: JSON.stringify(next) });
    },
  };
}

describe('live status', () => {
  test('shows a live dot and when the page was loaded', async () => {
    const page = await load();
    expect(page.el('live').hidden).toBe(false);
    expect(page.el('live').className).toBe('live');
    expect(page.el('live-text').textContent).toBe('live · updated t1');
  });

  test('says disconnected, keeps the last update time, and recovers', async () => {
    const page = await load();
    page.tick(2);
    page.source.onerror?.();
    expect(page.el('live').className).toBe('live off');
    expect(page.el('live-text').textContent).toBe('disconnected · last updated t1, reconnecting');
    page.tick(3);
    page.source.onopen?.();
    expect(page.el('live').className).toBe('live');
    expect(page.el('live-text').textContent).toBe('live · updated t1');
  });

  test('the update time moves only when a new report arrives', async () => {
    const page = await load();
    page.tick(5);
    page.push('1'); // the same report again: nothing changed
    expect(page.el('live-text').textContent).toBe('live · updated t1');
    page.push('2');
    expect(page.el('live-text').textContent).toBe('live · updated t5');
  });

  test('a page that is not live shows no status', async () => {
    const page = await load({});
    expect(page.el('live').hidden).toBeUndefined();
  });

  test('--watch pages show the status too, and have no stream to lose', async () => {
    const page = await load({ watch: true });
    expect(page.el('live').hidden).toBe(false);
    expect(page.el('live-text').textContent).toBe('live · updated t1');
  });
});

describe('markup', () => {
  test('the status has a dot, a text and starts hidden', async () => {
    const root = tmpRepo({ '.git/': '', 'AGENTS.md': '# A\n' });
    const out = renderHtml(await analyze({ cwd: root, agents: ['codex'] }), {
      stream: '/events',
      generated: '1',
    });
    expect(out).toContain(
      '<span id="live" class="live" hidden><span class="dot" aria-hidden="true"></span><span id="live-text"></span></span>',
    );
    expect(out).toContain('.live.off{');
  });
});

describe('toast', () => {
  test('there is none when the page loads', async () => {
    const page = await load();
    expect(page.el('toast').hidden).toBeUndefined();
    expect(page.timers).toHaveLength(0);
  });

  test('appears when a new report arrives and fades after three seconds', async () => {
    const page = await load();
    page.push('2');
    expect(page.el('toast').textContent).toBe('Files changed. The report was updated.');
    expect(page.el('toast').hidden).toBe(false);
    expect(page.timers.map((t) => t.ms)).toEqual([3000]);
    page.timers[0]?.fn();
    expect(page.el('toast').hidden).toBe(true);
  });

  test('the same report again shows nothing', async () => {
    const page = await load();
    page.push('1');
    expect(page.el('toast').hidden).toBeUndefined();
  });

  test('an older timer does not hide a newer toast', async () => {
    const page = await load();
    page.push('2');
    page.push('3');
    expect(page.timers).toHaveLength(2);
    page.timers[0]?.fn();
    expect(page.el('toast').hidden).toBe(false);
    page.timers[1]?.fn();
    expect(page.el('toast').hidden).toBe(true);
  });

  test('losing and regaining the connection is not a file change', async () => {
    const page = await load();
    page.source.onerror?.();
    page.source.onopen?.();
    expect(page.el('toast').hidden).toBeUndefined();
  });

  test('has an accessible live region in the markup', async () => {
    const root = tmpRepo({ '.git/': '', 'AGENTS.md': '# A\n' });
    const out = renderHtml(await analyze({ cwd: root, agents: ['codex'] }), { stream: '/events' });
    expect(out).toContain(
      '<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>',
    );
  });
});
