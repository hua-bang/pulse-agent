# Pulse Coder Harbor agent

This adapter runs the repository's committed Pulse CLI inside Harbor task containers. It is the reproducible comparison lane for SWE-bench, Terminal-Bench, Harbor Index, and any other Harbor dataset that supports installed CLI agents.

## Prerequisites

- Docker is running.
- Install the pinned Harbor version with `uv tool install harbor==0.20.0` (Python 3.12+).
- Commit the Pulse code you intend to test. The adapter uses `git archive HEAD`; it rejects tracked and untracked worktree changes by default.
- Keep provider URLs and env-var names in `~/.pulse-coder/models.json`. Keep API keys in environment variables only.

Run all commands from the Pulse repository root so Harbor can import `packages.cli.harness.tools.harbor.pulse_agent:PulseCoderAgent`.

## Validate the adapter

```bash
python3 -m unittest packages.cli.harness.tools.harbor.pulse_agent_config_test
python3 -m py_compile \
  packages/cli/harness/tools/harbor/pulse_agent.py \
  packages/cli/harness/tools/harbor/pulse_agent_config.py
uv run --python 3.12 --with harbor==0.20.0 \
  python -m unittest packages.cli.harness.tools.harbor.pulse_agent_contract_test
```

For the first container smoke, select one task from Harbor Hub:

```bash
harbor run \
  -t swe-bench/django__django-16938 \
  --agent packages.cli.harness.tools.harbor.pulse_agent:PulseCoderAgent \
  --model gpt-5.6-terra \
  --agent-env PULSE_OPENAI_API_KEY="$PULSE_OPENAI_API_KEY"
```

The adapter uploads the current commit, uses the task container's Node runtime, installs the pnpm version declared by the repository's `packageManager`, builds Pulse, and copies only the supported non-secret fields from the host models registry. Inline API keys are rejected. It then runs:

```text
pulse-coder -p --isolated --model … --timeout … --max-steps …
  --max-tokens … --output-format jsonl --trace-file /logs/agent/pulse-trace.jsonl
```

## SWE-bench Verified

Start with the fixed five-task smoke subset below, then one full run, then repeated runs. Pulse's step/token budget exhaustion and its own timeout remain gradeable attempts; authentication, API, installation, and unexpected process failures remain infrastructure errors.

```bash
harbor run \
  --dataset swe-bench/swe-bench-verified \
  --include-task-name swe-bench/django__django-16938 \
  --include-task-name swe-bench/pytest-dev__pytest-7236 \
  --include-task-name swe-bench/psf__requests-1142 \
  --include-task-name swe-bench/sympy__sympy-16886 \
  --include-task-name swe-bench/matplotlib__matplotlib-14623 \
  --agent packages.cli.harness.tools.harbor.pulse_agent:PulseCoderAgent \
  --model gpt-5.6-terra \
  --n-concurrent 1 \
  --agent-env PULSE_OPENAI_API_KEY="$PULSE_OPENAI_API_KEY"
```

Budget overrides are passed with additional `--agent-env` arguments:

```text
PULSE_BENCH_TIMEOUT_SECONDS=900
PULSE_BENCH_MAX_STEPS=100
PULSE_BENCH_MAX_TOKENS=500000
PULSE_CODER_MODELS_PATH=/path/on/the/host/models.json
PULSE_CODER_SOURCE_DIR=/path/on/the/host/pulse-agent
```

`PULSE_BENCH_ALLOW_DIRTY=1` intentionally benchmarks committed `HEAD` while ignoring all tracked and untracked worktree changes. Prefer committing instead so the recorded agent version (the 12-character Git commit) identifies the exact implementation.

## Comparison runs

Use the same dataset revision, task IDs, concurrency, timeout, attempts, and container provider. Pin exact agent and model versions. Harbor already includes comparison adapters such as `claude-code`, `codex`, `qwen-coder`, `kimi-cli`, `gemini-cli`, and `opencode`.

Run two views separately:

1. **Product comparison:** each coding agent with its recommended model. This measures the complete scaffold plus model.
2. **Model-controlled comparison:** agents that support the same endpoint/model with identical prompts and budgets. This better isolates CLI/engine quality.

Use the same five `--include-task-name` flags above for every smoke comparison. These templates force you to record the agent and model versions instead of silently taking `latest`:

```bash
SMOKE_TASKS=(
  --include-task-name swe-bench/django__django-16938
  --include-task-name swe-bench/pytest-dev__pytest-7236
  --include-task-name swe-bench/psf__requests-1142
  --include-task-name swe-bench/sympy__sympy-16886
  --include-task-name swe-bench/matplotlib__matplotlib-14623
)

harbor run -d swe-bench/swe-bench-verified \
  "${SMOKE_TASKS[@]}" \
  -a codex -m "$CODEX_MODEL" --agent-kwarg version="$CODEX_VERSION" \
  --n-concurrent 1

harbor run -d swe-bench/swe-bench-verified \
  "${SMOKE_TASKS[@]}" \
  -a claude-code -m "$CLAUDE_MODEL" --agent-kwarg version="$CLAUDE_CODE_VERSION" \
  --n-concurrent 1
```

Before a scored run, record `harbor==0.20.0`, the resolved dataset ref and task names from the Harbor job `config.json`, the Pulse Git commit, comparison-agent versions, and exact model IDs. Keep the raw job directory and Pulse `pulse-trace.jsonl` files. Report resolved rate alongside infrastructure-error rate, wall time, and token usage. Cost must come from provider billing or an independently verified price calculation because the Pulse trace does not currently emit cost.
