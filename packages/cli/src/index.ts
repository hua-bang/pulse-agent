import { parseCliArgs } from './ui-mode.js';
import { CoderCLI } from './readline/readline-host.js';

async function main(): Promise<void> {
  const parsed = parseCliArgs();

  if (parsed.print) {
    const { runPrintMode } = await import('./print/print-mode.js');
    process.exitCode = await runPrintMode(parsed.prompt, {
      modelSpec: parsed.model,
      isolated: parsed.isolated,
      timeoutSeconds: parsed.timeoutSeconds,
      maxSteps: parsed.maxSteps,
      maxTokens: parsed.maxTokens,
      outputFormat: parsed.outputFormat,
      traceFile: parsed.traceFile,
    });
    return;
  }

  if (parsed.uiMode === 'ink') {
    const { startInkTui } = await import('./ink/ink-launcher.js');
    await startInkTui({ continueLast: parsed.continueLast, verbose: parsed.verbose, model: parsed.model });
    return;
  }

  const cli = new CoderCLI(parsed.model);
  await cli.start({ continueLast: parsed.continueLast });
}

main().catch(error => {
  // Write straight to stderr: with the Ink host's EngineLogSink installed,
  // console.error is captured into the log file and a startup crash would
  // otherwise be silent.
  process.stderr.write(`Failed to start CLI: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
