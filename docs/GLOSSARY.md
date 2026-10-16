# Glossary

What the words in the ctxsize report mean. The same text appears as hover help and in the
"What do these words mean?" section of the HTML report.

<!-- Generated from src/report/glossary.ts by `npm run docs:glossary`. Do not edit by hand. -->

## Numbers

### Reads the most

The agent that loads the most text from your files before your first message. That text is sent again with every message you type.

Example: Windsurf, about 3,820 tokens.

### Cut off

Files, or the ends of files, that an agent never sees because they are over its size limit.

Example: A big file that is read only up to its limit.

### To fix

Everything worth fixing: files that are cut off plus things that may be ignored or wasted. Optional tips are counted apart.

Example: 5 = 1 cut-off file + 4 other things.

### Fix these first

The most important things to fix, worst first. The Fix list tab has all of them, grouped by file.

Example: A file that is cut off comes before an old file type.

### Agent

A coding assistant that reads files from your repo, such as Claude Code, Codex or Cursor.

Example: Claude Code and Windsurf are two agents.

### Token

A small piece of text an AI reads, about three quarters of a word. AI models count and charge by tokens.

Example: 1,000 tokens is roughly 750 words.

### Startup tokens

How much text the agent reads from your files before you type anything. Fewer is better, because it is paid for again with every message.

Example: ~3,820 tokens is about 2,900 words, before you say a word.

### On demand

Text the agent reads later, only when your work needs it. It costs nothing until then.

Example: A rule that only applies to Python files.

### Context window

The agent's memory: the most text it can hold in one conversation. Everything it reads counts against it.

Example: A 1M-token window holds about 750,000 words.

### % of window

How much of the agent's memory the startup text uses up. Lower leaves more room for your actual work.

Example: 0.4% means almost all of the memory is still free.

### Overhead tokens

Startup tokens times the number of messages: the extra text sent along over a whole conversation.

Example: 1,634 tokens × 80 messages = 130,720 tokens.

### Cost

A rough price for sending the startup text with every message, worked out from the price you enter. Caching can make the real price lower.

Example: 1,634 tokens at ₹250 per 1M tokens is about ₹0.41 per message.

### Model

The AI model the agent uses. It decides the size of the memory and how tokens are counted; you give the price yourself.

Example: Claude Code → Claude Haiku 5.5.

### Messages

How many messages you expect to send in one conversation. More messages means a bigger bill.

Example: 80 messages is a long working session.

### Your price

What you pay for input tokens, from your provider's price list. ctxsize has no prices of its own: without yours it shows tokens only.

Example: ₹250 per 1M tokens means 1,000 tokens cost ₹0.25.

### Cost per message

What the startup text costs each time you send a message, at your price. It is the startup tokens times your price per token.

Example: 1,634 tokens × ₹250 / 1,000,000 = ₹0.41.

### Cost per day

The cost per message times the messages you send on a normal day.

Example: ₹0.41 × 50 messages = ₹20.43.

### Cost per month

The cost per day times your working days in a month. A rough estimate: real bills depend on caching and your plan.

Example: ₹20.43 × 22 days = ₹449.

### Cheapest

The agent whose startup text costs the least per month at your price. Agents that read nothing from your repo are left out.

Example: Zed reads 103 tokens, so it costs the least here.

### Saves ~N tokens per message

How many tokens every message gets lighter once you make this fix, worked out from your own files. It is shown only when ctxsize can count it.

Example: Moving a 921-token section into a skill saves ~921 tokens per message.

### ~ (estimate)

A ~ means the number is an estimate. Only OpenAI models are counted with their own tokenizer; the others are approximated.

Example: ~1,634 means about 1,634, not exactly.

### * (default model)

ctxsize guessed which model this agent uses, because you did not say. Pick the real one to get better numbers.

Example: Cursor* → Claude Sonnet 5.5 is a guess.

## What an agent reads

### Instructions

The main files that tell the agent how to work in your repo.

Example: AGENTS.md or CLAUDE.md saying "use npm, not yarn".

### Rules

Extra instruction files kept in a rules folder. Some always load, some only for certain files.

Example: .cursor/rules/style.mdc

### Skills listing

The short name and description of each skill, read at startup so the agent knows what it can do. The full skill loads only when it is used.

Example: "deploy: Use when releasing to production."

### Memory

Notes an agent saves for itself between sessions.

Example: Claude Code's MEMORY.md.

### Category

The kind of file: instructions, rules, skills or memory.

Example: AGENTS.md is "Instructions".

### File

A file in your repo (or a skill) that this agent reads.

Example: docs/api-conventions.md

### Loads (startup / on demand / ignored)

When the agent reads a file: at startup (before your first message), on demand (later, only when needed) or never (ignored).

Example: AGENTS.md: startup. A rule for *.py files: on demand.

### Why

The reason the agent loads, skips or cuts this file.

Example: "CLAUDE.md in ancestor" means it sits in a parent folder.

### Count this file

Untick a file to see the numbers without it. This only changes this page, never your files.

Example: Untick the biggest file to see how much you would save.

### Checks

Extra tests that find waste or mistakes in your files: repeated text, skills with no description, big sections that could load on demand.

Example: "AGENTS.md and CLAUDE.md repeat 2 paragraphs."

### MCP servers

Add-on programs that give an agent extra tools. Their tool lists can add many tokens.

Example: A GitHub server adds tools like "create issue".

## Marks and labels

### ✓ Fine (green)

Nothing is cut off for this agent and no problem was found.

Example: Zed: 103 tokens, all loaded.

### ! and ? At risk (amber)

Something may be ignored or may not work as you expect, or a check found waste. Worth a look.

Example: ! a skill has no description.

### ✗ Dropped or cut (red)

The agent has a size limit and throws away the part that does not fit, or the whole file. It never sees that text.

Example: A 5,000-byte file with a 3,072-byte limit loses its end.

### Legacy

An old file type the tool may still read today but plans to stop supporting.

Example: .cursorrules, replaced by .cursor/rules.

### Over recommended size

The file is longer than the tool's advice. It still loads, but the agent may follow a long file less well.

Example: A 700-line file when the advice is under 200 lines.

### i Tip

An optional way to save tokens. Nothing is broken.

Example: Move a big section into a skill so it loads only when needed.

## Controls

### Per (tokens)

How many tokens your price is for. Price lists usually say per 1M or per 1K tokens.

Example: $3 per 1M tokens.

### Currency

The symbol or letters shown next to money. It only changes how numbers look; ctxsize does not convert between currencies.

Example: ₹, € or EUR.

### Name of this price

A short name so you can tell prices apart when you compare them, such as the model it belongs to.

Example: Model A.

### Messages per day

How many messages you send to an agent on a normal working day. The startup text goes along with every one of them.

Example: 50 messages a day.

### Working days per month

How many days a month you use the agent, to turn a daily cost into a monthly one.

Example: 22 days is a normal working month.

### Cached price (optional)

Some providers charge less for text they have seen a moment ago. Enter that lower price here if your provider has one, for the same number of tokens.

Example: ₹25 per 1M cached tokens.

### % of messages cached

How many of your messages get the cheaper cached price. Leave it empty if you are not sure; it only matters when you entered a cached price.

Example: 70 means 7 messages in 10.

### Compare another price

Add a second price, for example another model's, to see which one is cheaper for your repo. Prices in different currencies are shown but not compared.

Example: Model A against Model B.

### Which agents do you use?

Click an agent to include it or leave it out; everything on the page then counts only the agents you picked. Your choice is remembered in this browser.

Example: Leave out agents you never open.

### Show cost

Adds two columns to the chart: how much of the agent's memory the text uses, and the cost per month, once you have entered your price.

Example: 0.4% of memory, and ₹449 a month.

### Show this agent

Tick or untick to include or hide an agent in the summary, the chart and the numbers.

Example: Untick agents you do not use.

### Order

Move an agent up or down (drag it, or use the arrows). The order sets the tabs and "My order" in the chart.

Example: Put your favourite agent first.

### Sort bars by

Choose how the chart is ordered: most tokens first, highest cost first, name, or your own order.

Example: "Highest cost" puts the agent that reads the most on top.

### Search files

Type part of a file name to dim everything else in the picture and filter the table.

Example: Type "rules" to see only rule files.

### Reset

Puts every control on this page back to how the report first opened.

Example: Clears a model you picked and the messages you typed.

### Light / dark

Switches the page between a light and a dark look. Nothing else changes.

Example: Dark is easier on the eyes at night.

### Share this run

Save a picture of the results, or copy a short summary to paste into a pull request. Nothing is uploaded.

Example: Paste the summary into a pull request.
