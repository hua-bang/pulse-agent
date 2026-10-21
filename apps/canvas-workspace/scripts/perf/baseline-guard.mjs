#!/usr/bin/env node
/**
 * PR guard for perf/baselines.json: a PR may lower any Gate, but loosening
 * one needs the `perf-baseline` label. The bundle and runtime Gates read
 * baselines.json from the PR head, so without this guard a PR can pass every
 * Gate by raising the number it is checked against.
 *
 *   node scripts/perf/baseline-guard.mjs <base-sha>
 *
 * PERF_BASELINE_APPROVED=true (the label) turns a failure into a notice.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePolicyGate } from './metric-policy.mjs';

const BASELINES_REPO_PATH = 'apps/canvas-workspace/perf/baselines.json';

const describeGate = (gate) => {
  if (!gate) return 'none';
  const limit = evaluatePolicyGate(gate, null)?.limit;
  if (gate.kind === 'ratchet') return `ratchet ${gate.baseline} +${gate.tolerancePct}% (limit ${limit})`;
  return `${gate.kind} ${limit ?? JSON.stringify(gate)}`;
};

const isLooser = (before, after) => {
  if (!after) return true;
  if (before.kind !== after.kind || before.scope !== after.scope) return true;
  const beforeLimit = evaluatePolicyGate(before, null)?.limit;
  const afterLimit = evaluatePolicyGate(after, null)?.limit;
  if (before.kind === 'ratchet' || before.kind === 'max') return afterLimit > beforeLimit;
  if (before.kind === 'min') return afterLimit < beforeLimit;
  return afterLimit !== beforeLimit;
};

// A Gate only runs where its profile applies, so moving it to another
// profile, or narrowing that profile, can switch it off in CI.
const appliesTo = (baselines, profile) => JSON.stringify(baselines?.profiles?.[profile]?.appliesTo ?? null);

const profileChanged = (base, head, id) => {
  const before = base.policies[id].profile;
  const after = head?.policies?.[id]?.profile;
  return before !== after || appliesTo(base, before) !== appliesTo(head, after);
};

export const findLoosenedGates = (base, head) => Object.entries(base?.policies ?? {})
  .filter(([, policy]) => policy?.gate)
  .filter(([id, policy]) => isLooser(policy.gate, head?.policies?.[id]?.gate)
    || profileChanged(base, head, id))
  .map(([id, policy]) => ({
    id,
    before: `${describeGate(policy.gate)} @ ${policy.profile}`,
    after: `${describeGate(head?.policies?.[id]?.gate)} @ ${head?.policies?.[id]?.profile}`,
  }));

const main = () => {
  const baseSha = process.argv[2];
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseSha ?? '')) {
    throw new Error('usage: baseline-guard.mjs <base-sha>');
  }
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const head = JSON.parse(readFileSync(join(appRoot, 'perf/baselines.json'), 'utf-8'));
  let base;
  try {
    base = JSON.parse(execFileSync('git', ['show', `${baseSha}:${BASELINES_REPO_PATH}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    console.log('[perf:baseline-guard] base has no baselines.json; nothing to compare');
    return 0;
  }

  const loosened = findLoosenedGates(base, head);
  if (loosened.length === 0) {
    console.log('[perf:baseline-guard] PASS no Gate loosened against the base branch');
    return 0;
  }
  for (const gate of loosened) {
    console.log(`[perf:baseline-guard] LOOSENED ${gate.id}: ${gate.before} -> ${gate.after}`);
  }
  if (process.env.PERF_BASELINE_APPROVED === 'true') {
    console.log(`[perf:baseline-guard] ${loosened.length} loosened Gate(s) approved by the perf-baseline label`);
    return 0;
  }
  console.error(
    `[perf:baseline-guard] ${loosened.length} Gate(s) loosened without approval. `
    + 'Shrink the change, or have a maintainer add the `perf-baseline` label after reviewing the raise.',
  );
  return 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
