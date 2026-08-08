import json
import shlex
from pathlib import Path


PROVIDER_FIELDS = ('type', 'baseUrl', 'base_url', 'apiKeyEnv', 'api_key_env')
MODEL_FIELDS = ('model', 'provider', 'type', 'label', 'contextWindow', 'context_window', 'default')


def find_repo_root(start: Path) -> Path:
    """Find the Pulse monorepo root from this adapter or a caller path."""
    current = start.resolve()
    if current.is_file():
        current = current.parent
    for candidate in (current, *current.parents):
        if (candidate / 'pnpm-workspace.yaml').is_file() and (candidate / 'packages/cli/package.json').is_file():
            return candidate
    raise FileNotFoundError(f'Could not find Pulse repository root from {start}')


def positive_int(value: str, *, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f'{name} must be a positive integer') from exc
    if parsed <= 0:
        raise ValueError(f'{name} must be a positive integer')
    return parsed


def normalize_model_spec(model_name: str) -> str:
    """Translate Harbor's provider/model spelling to Pulse provider:model."""
    normalized = model_name.strip()
    if not normalized:
        raise ValueError('Harbor model name is required')
    if ':' not in normalized and '/' in normalized:
        provider, model = normalized.split('/', 1)
        return f'{provider}:{model}'
    return normalized


def build_cli_args(
    *,
    model_name: str,
    instruction: str,
    timeout_seconds: int,
    max_steps: int,
    max_tokens: int,
    trace_file: str,
):
    return [
        '-p',
        '--isolated',
        '--model',
        normalize_model_spec(model_name),
        '--timeout',
        str(timeout_seconds),
        '--max-steps',
        str(max_steps),
        '--max-tokens',
        str(max_tokens),
        '--output-format',
        'jsonl',
        '--trace-file',
        trace_file,
        instruction,
    ]


def build_install_command(source_dir: str) -> str:
    """Build Pulse with the pnpm version declared by the archived repository."""
    return (
        'set -euo pipefail; '
        f'cd {shlex.quote(source_dir)}; '
        'node --version; '
        'PULSE_PNPM_VERSION="$(node -p \'require("./package.json").packageManager.split("@")[1]\')"; '
        'export PNPM_HOME="$HOME/.local/share/pnpm"; '
        'export PATH="$PNPM_HOME:$PATH"; '
        'curl -fsSL https://get.pnpm.io/install.sh | '
        'env PNPM_VERSION="$PULSE_PNPM_VERSION" PNPM_HOME="$PNPM_HOME" SHELL=/bin/bash sh -; '
        'pnpm install --frozen-lockfile; '
        'pnpm --filter pulse-coder-cli... build'
    )


def build_run_command(*, executable: str, args) -> str:
    """Treat Pulse budget/timeout exits as gradeable attempts, not infra failures."""
    invocation = f'node {shlex.quote(executable)} {shlex.join(args)}'
    return (
        f'{invocation}; pulse_status=$?; '
        'case "$pulse_status" in 0|2|124) exit 0 ;; *) exit "$pulse_status" ;; esac'
    )


def parse_run_summary(output: str):
    """Return the final Pulse run_end event from mixed command output."""
    summary = None
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(event, dict) and event.get('type') == 'run_end':
            summary = event
    return summary


def sanitize_models_registry(parsed):
    """Keep only the models.json fields Pulse consumes and reject inline keys."""
    if isinstance(parsed, list):
        return [
            sanitized
            for entry in parsed
            if (sanitized := _sanitize_model_entry(entry)) is not None
        ]
    if not isinstance(parsed, dict):
        raise ValueError('models.json must contain an object or array')

    raw_providers = parsed.get('providers')
    providers = {}
    if isinstance(raw_providers, dict):
        for name, value in raw_providers.items():
            if not isinstance(value, dict):
                continue
            if 'apiKey' in value or 'api_key' in value:
                raise ValueError(
                    f'provider {name!r} contains inline credentials; use apiKeyEnv instead'
                )
            providers[name] = {key: value[key] for key in PROVIDER_FIELDS if key in value}

    raw_models = parsed.get('models')
    models = []
    if isinstance(raw_models, list):
        models = [
            sanitized
            for entry in raw_models
            if (sanitized := _sanitize_model_entry(entry)) is not None
        ]
    return {'providers': providers, 'models': models}


def _sanitize_model_entry(entry):
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return {key: entry[key] for key in MODEL_FIELDS if key in entry}
    return None
