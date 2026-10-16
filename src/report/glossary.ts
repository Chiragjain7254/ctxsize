// Every term the report uses, explained once, in plain English. This is the only place the
// wording lives: the hover help on the HTML page, its "What do these words mean?" section and
// docs/GLOSSARY.md are all made from GLOSSARY. Edit a definition here, then run
// `npm run docs:glossary` to refresh the docs. helpIcon() is copied into the page with
// Function.prototype.toString, so it must not use anything from outside itself.

export type GlossaryGroup = 'numbers' | 'reads' | 'marks' | 'controls';

export interface GlossaryEntry {
  /** Stable id: "startup" becomes the element id h-startup. */
  id: string;
  /** What the report calls it. */
  term: string;
  group: GlossaryGroup;
  /** One or two short sentences, no jargon. */
  text: string;
  /** A tiny example. */
  example: string;
}

export const GROUPS: { id: GlossaryGroup; title: string }[] = [
  { id: 'numbers', title: 'Numbers' },
  { id: 'reads', title: 'What an agent reads' },
  { id: 'marks', title: 'Marks and labels' },
  { id: 'controls', title: 'Controls' },
];

export const GLOSSARY: GlossaryEntry[] = [
  // ---- Numbers
  {
    id: 'reads-most',
    term: 'Reads the most',
    group: 'numbers',
    text: 'The agent that loads the most text from your files before your first message. That text is sent again with every message you type.',
    example: 'Windsurf, about 3,820 tokens.',
  },
  {
    id: 'cut-off',
    term: 'Cut off',
    group: 'numbers',
    text: 'Files, or the ends of files, that an agent never sees because they are over its size limit.',
    example: 'A big file that is read only up to its limit.',
  },
  {
    id: 'to-fix',
    term: 'To fix',
    group: 'numbers',
    text: 'Everything worth fixing: files that are cut off plus things that may be ignored or wasted. Optional tips are counted apart.',
    example: '5 = 1 cut-off file + 4 other things.',
  },
  {
    id: 'fix-first',
    term: 'Fix these first',
    group: 'numbers',
    text: 'The most important things to fix, worst first. The Fix list tab has all of them, grouped by file.',
    example: 'A file that is cut off comes before an old file type.',
  },
  {
    id: 'agent',
    term: 'Agent',
    group: 'numbers',
    text: 'A coding assistant that reads files from your repo, such as Claude Code, Codex or Cursor.',
    example: 'Claude Code and Windsurf are two agents.',
  },
  {
    id: 'token',
    term: 'Token',
    group: 'numbers',
    text: 'A small piece of text an AI reads, about three quarters of a word. AI models count and charge by tokens.',
    example: '1,000 tokens is roughly 750 words.',
  },
  {
    id: 'startup',
    term: 'Startup tokens',
    group: 'numbers',
    text: 'How much text the agent reads from your files before you type anything. Fewer is better, because it is paid for again with every message.',
    example: '~3,820 tokens is about 2,900 words, before you say a word.',
  },
  {
    id: 'ondemand',
    term: 'On demand',
    group: 'numbers',
    text: 'Text the agent reads later, only when your work needs it. It costs nothing until then.',
    example: 'A rule that only applies to Python files.',
  },
  {
    id: 'window',
    term: 'Context window',
    group: 'numbers',
    text: "The agent's memory: the most text it can hold in one conversation. Everything it reads counts against it.",
    example: 'A 1M-token window holds about 750,000 words.',
  },
  {
    id: 'pct',
    term: '% of window',
    group: 'numbers',
    text: "How much of the agent's memory the startup text uses up. Lower leaves more room for your actual work.",
    example: '0.4% means almost all of the memory is still free.',
  },
  {
    id: 'overhead',
    term: 'Overhead tokens',
    group: 'numbers',
    text: 'Startup tokens times the number of messages: the extra text sent along over a whole conversation.',
    example: '1,634 tokens × 80 messages = 130,720 tokens.',
  },
  {
    id: 'cost',
    term: 'Cost',
    group: 'numbers',
    text: "A rough price for sending the startup text with every message, at the model's normal input price. Caching can make the real price lower.",
    example: '$0.0131 is about one cent over 80 messages.',
  },
  {
    id: 'model',
    term: 'Model',
    group: 'numbers',
    text: 'The AI model the agent uses. It decides the price, the size of the memory and how tokens are counted.',
    example: 'Claude Code → Claude Haiku 5.5.',
  },
  {
    id: 'messages',
    term: 'Messages',
    group: 'numbers',
    text: 'How many messages you expect to send in one conversation. More messages means a bigger bill.',
    example: '80 messages is a long working session.',
  },
  {
    id: 'price',
    term: 'Price per 1M tokens',
    group: 'numbers',
    text: "What the model charges for one million input tokens, in US dollars. Leave it empty to use the model's own price.",
    example: '$3 per 1M tokens means 1,000 tokens cost $0.003.',
  },
  {
    id: 'estimate',
    term: '~ (estimate)',
    group: 'numbers',
    text: 'A ~ means the number is an estimate. Only OpenAI models are counted with their own tokenizer; the others are approximated.',
    example: '~1,634 means about 1,634, not exactly.',
  },
  {
    id: 'default',
    term: '* (default model)',
    group: 'numbers',
    text: 'ctxsize guessed which model this agent uses, because you did not say. Pick the real one to get better numbers.',
    example: 'Cursor* → Claude Sonnet 5.5 is a guess.',
  },

  // ---- What an agent reads
  {
    id: 'instructions',
    term: 'Instructions',
    group: 'reads',
    text: 'The main files that tell the agent how to work in your repo.',
    example: 'AGENTS.md or CLAUDE.md saying "use npm, not yarn".',
  },
  {
    id: 'rules',
    term: 'Rules',
    group: 'reads',
    text: 'Extra instruction files kept in a rules folder. Some always load, some only for certain files.',
    example: '.cursor/rules/style.mdc',
  },
  {
    id: 'skills',
    term: 'Skills listing',
    group: 'reads',
    text: 'The short name and description of each skill, read at startup so the agent knows what it can do. The full skill loads only when it is used.',
    example: '"deploy: Use when releasing to production."',
  },
  {
    id: 'memory',
    term: 'Memory',
    group: 'reads',
    text: 'Notes an agent saves for itself between sessions.',
    example: "Claude Code's MEMORY.md.",
  },
  {
    id: 'category',
    term: 'Category',
    group: 'reads',
    text: 'The kind of file: instructions, rules, skills or memory.',
    example: 'AGENTS.md is "Instructions".',
  },
  {
    id: 'file',
    term: 'File',
    group: 'reads',
    text: 'A file in your repo (or a skill) that this agent reads.',
    example: 'docs/api-conventions.md',
  },
  {
    id: 'loads',
    term: 'Loads (startup / on demand / ignored)',
    group: 'reads',
    text: 'When the agent reads a file: at startup (before your first message), on demand (later, only when needed) or never (ignored).',
    example: 'AGENTS.md: startup. A rule for *.py files: on demand.',
  },
  {
    id: 'why',
    term: 'Why',
    group: 'reads',
    text: 'The reason the agent loads, skips or cuts this file.',
    example: '"CLAUDE.md in ancestor" means it sits in a parent folder.',
  },
  {
    id: 'count',
    term: 'Count this file',
    group: 'reads',
    text: 'Untick a file to see the numbers without it. This only changes this page, never your files.',
    example: 'Untick the biggest file to see how much you would save.',
  },
  {
    id: 'checks',
    term: 'Checks',
    group: 'reads',
    text: 'Extra tests that find waste or mistakes in your files: repeated text, skills with no description, big sections that could load on demand.',
    example: '"AGENTS.md and CLAUDE.md repeat 2 paragraphs."',
  },
  {
    id: 'mcp',
    term: 'MCP servers',
    group: 'reads',
    text: 'Add-on programs that give an agent extra tools. Their tool lists can add many tokens.',
    example: 'A GitHub server adds tools like "create issue".',
  },

  // ---- Marks and labels
  {
    id: 'ok',
    term: '✓ Fine (green)',
    group: 'marks',
    text: 'Nothing is cut off for this agent and no problem was found.',
    example: 'Zed: 103 tokens, all loaded.',
  },
  {
    id: 'risk',
    term: '! and ? At risk (amber)',
    group: 'marks',
    text: 'Something may be ignored or may not work as you expect, or a check found waste. Worth a look.',
    example: '! a skill has no description.',
  },
  {
    id: 'dropped',
    term: '✗ Dropped or cut (red)',
    group: 'marks',
    text: 'The agent has a size limit and throws away the part that does not fit, or the whole file. It never sees that text.',
    example: 'A 5,000-byte file with a 3,072-byte limit loses its end.',
  },
  {
    id: 'legacy',
    term: 'Legacy',
    group: 'marks',
    text: 'An old file type the tool may still read today but plans to stop supporting.',
    example: '.cursorrules, replaced by .cursor/rules.',
  },
  {
    id: 'oversize',
    term: 'Over recommended size',
    group: 'marks',
    text: "The file is longer than the tool's advice. It still loads, but the agent may follow a long file less well.",
    example: 'A 700-line file when the advice is under 200 lines.',
  },
  {
    id: 'tip',
    term: 'i Tip',
    group: 'marks',
    text: 'An optional way to save tokens. Nothing is broken.',
    example: 'Move a big section into a skill so it loads only when needed.',
  },

  // ---- Controls
  {
    id: 'chips',
    term: 'Which agents do you use?',
    group: 'controls',
    text: 'Click an agent to include it or leave it out; everything on the page then counts only the agents you picked. Your choice is remembered in this browser.',
    example: 'Leave out agents you never open.',
  },
  {
    id: 'show-cost',
    term: 'Show cost',
    group: 'controls',
    text: "Adds two columns to the chart: how much of the agent's memory the text uses, and a rough price for the whole conversation.",
    example: '0.4% of memory, about $0.61 for 80 messages.',
  },
  {
    id: 'include',
    term: 'Show this agent',
    group: 'controls',
    text: 'Tick or untick to include or hide an agent in the summary, the chart and the numbers.',
    example: 'Untick agents you do not use.',
  },
  {
    id: 'order',
    term: 'Order',
    group: 'controls',
    text: 'Move an agent up or down (drag it, or use the arrows). The order sets the tabs and "My order" in the chart.',
    example: 'Put your favourite agent first.',
  },
  {
    id: 'sort',
    term: 'Sort bars by',
    group: 'controls',
    text: 'Choose how the chart is ordered: most tokens first, highest cost first, name, or your own order.',
    example: '"Highest cost" puts the priciest agent on top.',
  },
  {
    id: 'search',
    term: 'Search files',
    group: 'controls',
    text: 'Type part of a file name to dim everything else in the picture and filter the table.',
    example: 'Type "rules" to see only rule files.',
  },
  {
    id: 'reset',
    term: 'Reset',
    group: 'controls',
    text: 'Puts every control on this page back to how the report first opened.',
    example: 'Clears a model you picked and the messages you typed.',
  },
  {
    id: 'theme',
    term: 'Light / dark',
    group: 'controls',
    text: 'Switches the page between a light and a dark look. Nothing else changes.',
    example: 'Dark is easier on the eyes at night.',
  },
  {
    id: 'share',
    term: 'Share this run',
    group: 'controls',
    text: 'Save a picture of the results, or copy a short summary to paste into a pull request. Nothing is uploaded.',
    example: 'Paste the summary into a pull request.',
  },
];

/** The entry for an id; throws on a typo so a missing definition fails the tests, not the reader. */
export function entry(id: string): GlossaryEntry {
  const found = GLOSSARY.find((e) => e.id === id);
  if (!found) throw new Error(`no glossary entry "${id}"`);
  return found;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The small "i" button that opens the help for one term; the text itself is in helpDefs(). */
export function helpIcon(id: string): string {
  return `<button type="button" class="ii" data-help="${id}" aria-labelledby="ht-${id}" aria-describedby="hd-${id}"><span aria-hidden="true">i</span></button>`;
}

/** The hidden text every icon points at with aria-describedby. Written once per page. */
export function helpDefs(): string {
  return GLOSSARY.map(
    (e) =>
      `<div id="h-${e.id}"><b id="ht-${e.id}">${esc(e.term)}</b><span id="hd-${e.id}"><span class="hx">${esc(e.text)}</span> <i>Example: ${esc(e.example)}</i></span></div>`,
  ).join('');
}

/** The "What do these words mean?" section: the same text, grouped. */
export function glossaryHtml(): string {
  return GROUPS.map(
    (g) =>
      `<h3>${esc(g.title)}</h3><dl>${GLOSSARY.filter((e) => e.group === g.id)
        .map(
          (e) => `<dt>${esc(e.term)}</dt><dd>${esc(e.text)} <i>Example: ${esc(e.example)}</i></dd>`,
        )
        .join('')}</dl>`,
  ).join('');
}

/** docs/GLOSSARY.md. */
export function glossaryMarkdown(): string {
  const out = [
    '# Glossary',
    '',
    'What the words in the ctxsize report mean. The same text appears as hover help and in the',
    '"What do these words mean?" section of the HTML report.',
    '',
    '<!-- Generated from src/report/glossary.ts by `npm run docs:glossary`. Do not edit by hand. -->',
    '',
  ];
  for (const g of GROUPS) {
    out.push(`## ${g.title}`, '');
    for (const e of GLOSSARY.filter((x) => x.group === g.id)) {
      out.push(`### ${e.term}`, '', e.text, '', `Example: ${e.example}`, '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}
