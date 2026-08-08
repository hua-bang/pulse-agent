import json
import shlex
import subprocess
import tempfile
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from .pulse_agent_config import (
    build_cli_args,
    build_install_command,
    build_run_command,
    find_repo_root,
    parse_run_summary,
    positive_int,
    sanitize_models_registry,
)


REMOTE_SOURCE_ARCHIVE = '/installed-agent/pulse-agent.tar.gz'
REMOTE_SOURCE_DIR = '/opt/pulse-agent'
REMOTE_MODELS_FILE = '/installed-agent/models.json'
REMOTE_TRACE_FILE = '/logs/agent/pulse-trace.jsonl'


class PulseCoderAgent(BaseInstalledAgent):
    """Run the repository's current Pulse CLI commit inside a Harbor task."""

    SUPPORTS_ATIF = False

    @staticmethod
    def name() -> str:
        return 'pulse-coder'

    def _source_dir(self) -> Path:
        configured = self._get_env('PULSE_CODER_SOURCE_DIR')
        return find_repo_root(Path(configured).expanduser() if configured else Path(__file__))

    def _models_path(self) -> Path:
        configured = self._get_env('PULSE_CODER_MODELS_PATH')
        return Path(configured).expanduser() if configured else Path.home() / '.pulse-coder/models.json'

    def _budget(self, name: str, default: int) -> int:
        return positive_int(self._get_env(name) or str(default), name=name)

    def _create_source_archive(self, target: Path) -> str:
        source_dir = self._source_dir()
        changes = subprocess.run(
            ['git', '-C', str(source_dir), 'status', '--porcelain', '--untracked-files=normal'],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        if changes and self._get_env('PULSE_BENCH_ALLOW_DIRTY') != '1':
            raise RuntimeError(
                'Pulse source has tracked or untracked worktree changes. Commit them first, or set '
                'PULSE_BENCH_ALLOW_DIRTY=1 to benchmark committed HEAD while intentionally ignoring them.'
            )
        commit = subprocess.run(
            ['git', '-C', str(source_dir), 'rev-parse', 'HEAD'],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        subprocess.run(
            ['git', '-C', str(source_dir), 'archive', '--format=tar.gz', f'--output={target}', 'HEAD'],
            check=True,
        )
        return commit

    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                'if [ -f /etc/alpine-release ]; then '
                'apk add --no-cache curl bash nodejs build-base ripgrep tar; '
                'elif command -v apt-get >/dev/null 2>&1; then '
                'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y '
                'curl bash nodejs build-essential ripgrep tar; '
                'elif command -v yum >/dev/null 2>&1; then '
                'yum install -y curl bash nodejs gcc gcc-c++ make ripgrep tar; '
                'else echo "Unsupported task image: no apk, apt-get, or yum" >&2; exit 1; fi'
            ),
        )

        with tempfile.TemporaryDirectory(prefix='pulse-harbor-agent-') as temp_dir:
            archive = Path(temp_dir) / 'pulse-agent.tar.gz'
            commit = self._create_source_archive(archive)
            self._version = commit[:12]
            await environment.upload_file(archive, REMOTE_SOURCE_ARCHIVE)

        owner = shlex.quote(str(environment.default_user or 'root'))
        await self.exec_as_root(
            environment,
            command=(
                f'rm -rf {shlex.quote(REMOTE_SOURCE_DIR)} && '
                f'mkdir -p {shlex.quote(REMOTE_SOURCE_DIR)} && '
                f'tar -xzf {shlex.quote(REMOTE_SOURCE_ARCHIVE)} -C {shlex.quote(REMOTE_SOURCE_DIR)} && '
                f'chown -R {owner} {shlex.quote(REMOTE_SOURCE_DIR)}'
            ),
        )

        models_path = self._models_path()
        if models_path.is_file():
            with tempfile.TemporaryDirectory(prefix='pulse-harbor-models-') as temp_dir:
                sanitized_models = Path(temp_dir) / 'models.json'
                parsed_models = json.loads(models_path.read_text(encoding='utf-8'))
                sanitized_models.write_text(
                    json.dumps(sanitize_models_registry(parsed_models), indent=2),
                    encoding='utf-8',
                )
                await environment.upload_file(sanitized_models, REMOTE_MODELS_FILE)
            await self.exec_as_root(
                environment,
                command=f'chown {owner} {shlex.quote(REMOTE_MODELS_FILE)}',
            )
            await self.exec_as_agent(
                environment,
                command=(
                    'mkdir -p "$HOME/.pulse-coder" && '
                    f'cp {shlex.quote(REMOTE_MODELS_FILE)} "$HOME/.pulse-coder/models.json"'
                ),
            )
        else:
            self.logger.warning(
                'Pulse models file not found at %s; --model will use bare provider defaults',
                models_path,
            )

        await self.exec_as_agent(
            environment,
            command=build_install_command(REMOTE_SOURCE_DIR),
            timeout_sec=1_800,
        )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        if not self.model_name:
            raise ValueError('Harbor --model is required for Pulse Coder runs')

        timeout_seconds = self._budget('PULSE_BENCH_TIMEOUT_SECONDS', 900)
        trace_file = self._get_env('PULSE_BENCH_TRACE_FILE') or REMOTE_TRACE_FILE
        args = build_cli_args(
            model_name=self.model_name,
            instruction=instruction,
            timeout_seconds=timeout_seconds,
            max_steps=self._budget('PULSE_BENCH_MAX_STEPS', 100),
            max_tokens=self._budget('PULSE_BENCH_MAX_TOKENS', 500_000),
            trace_file=trace_file,
        )
        command = build_run_command(
            executable=REMOTE_SOURCE_DIR + '/packages/cli/dist/index.cjs',
            args=args,
        )
        result = await self.exec_as_agent(
            environment,
            command=command,
            cwd='/app',
            timeout_sec=timeout_seconds + 60,
        )
        summary = parse_run_summary(result.stdout or '')
        if summary:
            usage = summary.get('usage') if isinstance(summary.get('usage'), dict) else {}
            context.n_input_tokens = usage.get('inputTokens')
            context.n_cache_tokens = usage.get('cachedInputTokens')
            context.n_output_tokens = usage.get('outputTokens')
            context.metadata = {
                'status': summary.get('status'),
                'duration_ms': summary.get('durationMs'),
                'steps': summary.get('steps'),
                'trace_file': trace_file,
                'source_commit': self.version(),
            }
