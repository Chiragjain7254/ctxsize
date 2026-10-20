# Security policy

ctxsize only reads files. It never runs agent code or sends data over the network. Two things start a process, only when you ask: `--serve` listens on 127.0.0.1 (this computer only), and `--mcp` starts the local MCP servers in your repo's config.

## Reporting a vulnerability

Please use [private vulnerability reporting](../../security/advisories/new) instead of a public
issue. Expect a first reply within 7 days.

## Supported versions

The latest minor release gets fixes.
