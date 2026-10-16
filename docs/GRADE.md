# Context health grade

ctxsize gives each agent, and the repo overall, a grade from **A to F**. It answers one question: *how healthy are the files this agent loads before you type?*

The grade is not a second opinion. It is counted from the same list of problems as the **Fix list**, so the two always agree:

- **A** means the Fix list is empty.
- Anything cut off or left out caps the grade at **C**.

## The rules

Every problem in the Fix list is one of two kinds:

| Kind | Examples | Points taken off |
| --- | --- | --- |
| **Cut off or left out** | a file longer than the agent's limit (its end is cut), a file dropped because the size limit was used up, a skill left out of the skill list, an `@import` nested too deep | 15 each |
| **Other thing to fix** | a file longer than the agent recommends, a skill with no description or a vague one, a skill description close to being cut, duplicate files or paragraphs, an old file type, a file with an error (bad YAML, a missing import), a startup load that takes 20% or more of the agent's context window | 5 each |

Optional tips (marked "optional" in the Fix list) take nothing off.

```
score  = max(0, 100 - 15 x (things cut off) - 5 x (other things to fix))
```

| Grade | Score | Also |
| --- | --- | --- |
| A | 100 | nothing to fix |
| B | 80 to 99 | nothing is cut off |
| C | 60 to 79 | or a B with something cut off |
| D | 40 to 59 | |
| F | below 40 | |

## What is graded

- **Per agent:** the problems that concern that agent. A duplicate that only one agent loads counts for that agent. A skill without a description counts for every agent that loads it. An agent that loads nothing from the repo gets no grade (`-`).
- **Overall:** all problems of the agents shown, each counted once, even when several agents share it. Hide an agent (`--agents`) and the overall grade is for the ones left.

The five rules in the order people meet them:

1. **Cut-off files.** A file past an agent's documented limit loses its end. Limits and their sources are in [`src/profiles.ts`](../src/profiles.ts).
2. **At-risk files and skills.** The docs say something may be dropped, depending on how you use the agent.
3. **Duplicates.** The same text in two files that one agent reads is paid for twice.
4. **Startup size versus the window.** An agent whose startup load takes 20% or more of its context window has a problem. Without a known window nothing is compared.
5. **Skill problems.** No description, a vague one, no "Use when", two skills that sound alike.

## Where you see it

- Terminal: a `Context health: B (95/100)` line at the top of the summary and a Grade column.
- HTML report: a grade badge on the Overview verdict, and the grade in each agent's hover help.
- `--markdown`: a headline and a Grade column.
- `--json`: a top-level `grade` with `overall` and one entry per agent (`letter`, `score`, `bad`, `warn`). See [report.schema.json](report.schema.json).
- `--card`: the grade is the big letter.
- `--badge`: a Markdown badge with the grade and the startup tokens.

## Caveats

- It grades your files against what each agent's public docs say, not how well your instructions are written. A short file full of bad advice still gets an A.
- Token counts are estimates, so a startup load near 20% of the window may fall on either side of the line.
- The thresholds (15 points, 5 points, 20%) are a judgement call. If they feel wrong on your repo, [open an issue](https://github.com/Chiragjain7254/ctxsize/issues/new?template=feature_request.yml) with the output.
