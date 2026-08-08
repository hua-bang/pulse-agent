import unittest
from pathlib import Path

from packages.cli.harness.tools.harbor.pulse_agent_config import (
    build_cli_args,
    build_install_command,
    build_run_command,
    find_repo_root,
    normalize_model_spec,
    parse_run_summary,
    positive_int,
    sanitize_models_registry,
)


class PulseAgentConfigTest(unittest.TestCase):
    def test_normalizes_harbor_provider_model_syntax(self) -> None:
        self.assertEqual(normalize_model_spec('openai/gpt-5.6-terra'), 'openai:gpt-5.6-terra')
        self.assertEqual(normalize_model_spec('gpt-5.6-terra'), 'gpt-5.6-terra')

    def test_requires_positive_integer_budgets(self) -> None:
        self.assertEqual(positive_int('42', name='PULSE_BENCH_MAX_STEPS'), 42)
        for value in ('0', '-1', 'nope'):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, 'PULSE_BENCH_MAX_STEPS'):
                    positive_int(value, name='PULSE_BENCH_MAX_STEPS')

    def test_builds_headless_benchmark_arguments(self) -> None:
        self.assertEqual(
            build_cli_args(
                model_name='openai/gpt-5.6-terra',
                instruction='fix the failing test',
                timeout_seconds=900,
                max_steps=100,
                max_tokens=500_000,
                trace_file='/logs/agent/pulse-trace.jsonl',
            ),
            [
                '-p', '--isolated',
                '--model', 'openai:gpt-5.6-terra',
                '--timeout', '900',
                '--max-steps', '100',
                '--max-tokens', '500000',
                '--output-format', 'jsonl',
                '--trace-file', '/logs/agent/pulse-trace.jsonl',
                'fix the failing test',
            ],
        )

    def test_builds_install_command_from_repository_package_manager(self) -> None:
        command = build_install_command('/opt/pulse-agent')
        self.assertIn("node -p 'require(\"./package.json\").packageManager.split(\"@\")[1]'", command)
        self.assertIn('https://get.pnpm.io/install.sh', command)
        self.assertIn('pnpm --filter pulse-coder-cli... build', command)
        self.assertNotIn(' npm ', command)
        self.assertNotIn('nvm', command)

    def test_budget_exits_are_completed_attempts_but_errors_still_fail(self) -> None:
        command = build_run_command(
            executable='/opt/pulse-agent/packages/cli/dist/index.cjs',
            args=['-p', 'fix it'],
        )
        self.assertIn('case "$pulse_status" in 0|2|124) exit 0', command)
        self.assertIn('*) exit "$pulse_status"', command)

    def test_finds_repository_root(self) -> None:
        root = find_repo_root(Path(__file__))
        self.assertTrue((root / 'pnpm-workspace.yaml').is_file())
        self.assertTrue((root / 'packages/cli/package.json').is_file())

    def test_parses_run_end_usage_from_jsonl(self) -> None:
        summary = parse_run_summary(
            'not-json\n'
            '{"type":"run_start"}\n'
            '{"type":"run_end","status":"completed","durationMs":1234,"steps":7,'
            '"usage":{"inputTokens":100,"outputTokens":20,"cachedInputTokens":30}}\n'
        )
        self.assertEqual(summary['status'], 'completed')
        self.assertEqual(summary['durationMs'], 1234)
        self.assertEqual(summary['usage']['inputTokens'], 100)

    def test_sanitizes_models_registry_to_supported_non_secret_fields(self) -> None:
        sanitized = sanitize_models_registry({
            'providers': {
                'openai': {
                    'type': 'openai',
                    'baseUrl': 'https://example.test/v1',
                    'apiKeyEnv': 'PULSE_OPENAI_API_KEY',
                    'headers': {'Authorization': 'Bearer secret'},
                },
            },
            'models': [{
                'model': 'gpt-test',
                'provider': 'openai',
                'contextWindow': 128000,
                'unknown': 'drop-me',
            }],
        })
        self.assertEqual(sanitized['providers']['openai'], {
            'type': 'openai',
            'baseUrl': 'https://example.test/v1',
            'apiKeyEnv': 'PULSE_OPENAI_API_KEY',
        })
        self.assertNotIn('secret', str(sanitized))
        self.assertNotIn('unknown', str(sanitized))

    def test_rejects_inline_api_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, 'inline credentials'):
            sanitize_models_registry({
                'providers': {'openai': {'type': 'openai', 'apiKey': 'sk-secret'}},
                'models': [],
            })

    def test_drops_invalid_model_entries(self) -> None:
        sanitized = sanitize_models_registry({
            'providers': {},
            'models': [None, 7, 'openai:gpt-test', {'model': 'gpt-test'}],
        })
        self.assertEqual(sanitized['models'], ['openai:gpt-test', {'model': 'gpt-test'}])
        self.assertEqual(sanitize_models_registry([None, 'openai:gpt-test']), ['openai:gpt-test'])


if __name__ == '__main__':
    unittest.main()
