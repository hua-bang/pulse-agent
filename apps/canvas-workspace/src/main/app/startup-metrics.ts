/**
 * Startup phase marks for the main process.
 *
 * Records milestones along the boot critical path (whenReady → seeding →
 * IPC wiring → plugin activation → window open → renderer dom-ready) so the
 * app harness can parse a single structured log line and diff phases across
 * builds. Guards the D-dimension findings (serial bootstrap chain) from
 * docs/performance-analysis-consolidated.md.
 *
 * Timestamps are `performance.now()` — ms since main-process start.
 */
import { performance } from 'node:perf_hooks';

const phases: Array<{ name: string; at: number }> = [];
let logged = false;

export const startupMark = (name: string): void => {
  // First mark per name wins; repeat window opens don't rewrite history.
  if (phases.some((phase) => phase.name === name)) return;
  phases.push({ name, at: Math.round(performance.now()) });
};

export const startupPhases = (): Record<string, number> =>
  Object.fromEntries(phases.map((phase) => [phase.name, phase.at]));

/**
 * Emit the summary once (idempotent), as a single parseable line:
 * `[perf] startup {"whenReady":123,...}` — the harness `logs` command and
 * grep both pick it up.
 */
export const logStartupSummaryOnce = (
  writeLog: (scope: string, message: string, detail?: string) => unknown,
): void => {
  if (logged) return;
  logged = true;
  // Only emit the structured log line under the perf harness — keeps normal
  // dev/build stdout free of [perf] noise. The phase marks themselves are
  // still collected (cheap, 6× Array.push) so a renderer-side read stays
  // available; only the log emission is gated.
  if (!process.env.PULSE_CANVAS_PERF) return;
  const summary = JSON.stringify(startupPhases());
  console.log(`[perf] startup ${summary}`);
  void writeLog('perf', 'startup-phases', summary);
};
