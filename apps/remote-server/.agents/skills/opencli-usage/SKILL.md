---
name: opencli-usage
description: Use when running OpenCLI commands on this remote server. Prefer public API adapters and CLI Hub passthrough on Linux; browser-backed website adapters require Chrome/Chromium, the OpenCLI Browser Bridge extension, and an interactive desktop session.
version: 1.6.3
author: jackwener
tags: [opencli, cli, linux, server, hackernews, arxiv, wikipedia, gh, docker, automation]
---

# OpenCLI Usage on `apps/remote-server`

Use this skill when the task can benefit from OpenCLI's built-in adapters or CLI passthrough.

## Runtime Reality on This Host

- `opencli` is installed globally and can be invoked directly.
- This host is a Linux server without a guaranteed interactive Chrome session.
- Prefer commands that do not require a browser.
- Treat browser-backed adapters as unavailable unless the user explicitly provides a desktop session with Chrome/Chromium and the Browser Bridge extension installed.

## Safe Default Workflow

1. Check whether the task can be solved with a public API adapter.
2. If not, check whether an existing local CLI should be called through OpenCLI's CLI Hub.
3. Only suggest browser-backed adapters when the environment requirement is clearly satisfied.

## High-Value Commands for This Server

### Public API Adapters

These work without Chrome:

```bash
opencli hackernews top --limit 10 --format json
opencli hackernews search "agents"
opencli arxiv search "coding agents"
opencli wikipedia summary "OpenCLI"
opencli stackoverflow search "vitest mock"
opencli bbc news
opencli devto top
opencli hf top
opencli yahoo-finance quote AAPL
```

Commonly useful public adapters:

- `hackernews`: `top` `new` `best` `ask` `show` `jobs` `search` `user`
- `arxiv`: `search` `paper`
- `wikipedia`: `search` `summary` `random` `trending`
- `stackoverflow`: `hot` `search` `bounties` `unanswered`
- `bbc`: `news`
- `devto`: `top` `tag` `user`
- `hf`: `top`
- `dictionary`: `search` `synonyms` `examples`
- `apple-podcasts`: `search` `episodes` `top`
- `xiaoyuzhou`: `podcast` `podcast-episodes` `episode`
- `yahoo-finance`: `quote`
- `barchart`: `quote` `options` `greeks` `flow`
- `sinafinance`: `news`
- `lobsters`: `hot` `newest` `active` `tag`
- `lesswrong`: `curated` `frontpage` `new` `top` `read` `comments`
- `steam`: `top-sellers`

### CLI Hub

Use OpenCLI as a discovery and passthrough layer for local CLIs:

```bash
opencli gh pr list --limit 5
opencli docker ps
opencli lark-cli calendar +agenda
opencli register mycli
```

### Output Formats

Prefer machine-readable output when the result will be summarized or piped:

```bash
opencli hackernews top --limit 5 --format json
opencli arxiv search "test-time compute" -f yaml
opencli wikipedia summary "TypeScript" -f md
```

Supported formats: `table`, `json`, `yaml`, `md`, `csv`.

## Browser-Backed Adapters

Examples: `twitter`, `reddit`, `bilibili`, `zhihu`, `xiaohongshu`, `weibo`, `youtube`, `gemini`, `doubao`.

Do not assume these are usable on this server. They require all of the following:

1. Chrome or Chromium running.
2. The OpenCLI Browser Bridge extension loaded in `chrome://extensions`.
3. A logged-in browser session for the target site.
4. An interactive desktop environment or equivalent remote GUI session.

If those prerequisites are not present, use a public API adapter, a direct API, or another automation stack instead.

## Basic Checks

```bash
opencli --help
opencli list
opencli doctor
```

- `opencli doctor` is only useful when trying to use browser-backed adapters.
- A successful public API command is the quickest smoke test on this host.

## Recommended Decision Rule

- News, research, docs, rankings, finance snapshots: use OpenCLI public adapters.
- Existing shell tooling: use OpenCLI CLI Hub if unified discovery is useful.
- Logged-in websites and GUI automation: do not default to OpenCLI on this server.
