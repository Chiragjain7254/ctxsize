# Roadmap

A short, honest plan. It changes when you tell me something I did not know.

**Direction-changing ideas are welcome.** If you think ctxsize should be something else, or do something I have not considered, open an [idea in Discussions](https://github.com/Chiragjain7254/ctxsize/discussions/categories/ideas) or an issue. "Why not X?" is a good question.

What does not change: ctxsize runs offline, sends nothing anywhere, and never runs your agents. Token counts stay labelled as estimates, and every claim about an agent links to its official docs.

## Now (0.2.0)

- The context health grade and the share card ([docs/GRADE.md](docs/GRADE.md)).
- `ctxsize init`, `--badge`, and setups for hooks, VS Code and CI ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).
- Getting people to run the fruit test on real agents, so predictions turn into checked facts ([docs/VERIFY.md](docs/VERIFY.md)).

## Next

- More agents, mostly through pull requests: [#12](https://github.com/Chiragjain7254/ctxsize/issues/12), [docs/ADD-AGENT.md](docs/ADD-AGENT.md).
- Better CI output: [#13](https://github.com/Chiragjain7254/ctxsize/issues/13).
- Counting what Cursor's "apply intelligently" rules cost at startup: [#6](https://github.com/Chiragjain7254/ctxsize/issues/6).
- A schema for `--history --json`: [#8](https://github.com/Chiragjain7254/ctxsize/issues/8).
- Telling a crash apart from a failed gate by exit code: [#9](https://github.com/Chiragjain7254/ctxsize/issues/9).
- Re-checking every limit against the docs on a schedule, and re-running the 50-repo study with the grade.

## Later (ideas, not promises)

- Exact token counts for agents whose provider publishes an offline tokenizer.
- An editor extension that shows the grade next to the instruction file.
- A tool for measuring what an agent really loads in a live session, beyond what its docs say. This needs care: ctxsize would have to run something, and that changes what it promises.

## Not planned

- Anything that needs a network call or an account.
- Prices of its own: they change too often. You give yours.
- Judging whether your instructions are *good*. ctxsize weighs and checks files; it does not read them for quality.

See the open [issues](https://github.com/Chiragjain7254/ctxsize/issues) for everything in flight, and [CONTRIBUTING.md](CONTRIBUTING.md) to join in.
