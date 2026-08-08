import asyncio
import tempfile
import unittest
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.models.agent.context import AgentContext

from packages.cli.harness.tools.harbor.pulse_agent import PulseCoderAgent


class PulseAgentHarborContractTest(unittest.TestCase):
    def test_imports_against_pinned_harbor_release(self) -> None:
        self.assertEqual(version('harbor'), '0.20.0')
        self.assertTrue(issubclass(PulseCoderAgent, BaseInstalledAgent))
        self.assertEqual(PulseCoderAgent.name(), 'pulse-coder')

    def test_run_uses_harbor_exec_contract_and_populates_context(self) -> None:
        class FakeEnvironment:
            def __init__(self) -> None:
                self.calls = []

            async def exec(self, **kwargs):
                self.calls.append(kwargs)
                return SimpleNamespace(
                    return_code=0,
                    stdout=(
                        '{"type":"run_end","status":"completed","durationMs":42,'
                        '"steps":3,"usage":{"inputTokens":100,"outputTokens":20,'
                        '"cachedInputTokens":30}}\n'
                    ),
                    stderr='',
                )

        with tempfile.TemporaryDirectory() as temp_dir:
            agent = PulseCoderAgent(Path(temp_dir), model_name='openai/gpt-test')
            environment = FakeEnvironment()
            context = AgentContext()
            asyncio.run(agent.run('fix it', environment, context))

        self.assertEqual(len(environment.calls), 1)
        self.assertEqual(environment.calls[0]['cwd'], '/app')
        self.assertIn('--model openai:gpt-test', environment.calls[0]['command'])
        self.assertEqual(context.n_input_tokens, 100)
        self.assertEqual(context.n_cache_tokens, 30)
        self.assertEqual(context.n_output_tokens, 20)
        self.assertEqual(context.metadata['status'], 'completed')


if __name__ == '__main__':
    unittest.main()
