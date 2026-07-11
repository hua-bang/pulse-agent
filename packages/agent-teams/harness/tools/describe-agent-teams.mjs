#!/usr/bin/env node
/**
 * describe-agent-teams — static parity snapshot for packages/agent-teams.
 *
 * Two mechanical drift checks whose inputs are static (no runtime, no build):
 *
 *   1. runtime TeamEventType ↔ emit() parity: every member of the
 *      `TeamEventType` union (src/runtime/types.ts) should have at least one
 *      `this.emit(_, '<type>')` call site in team-runtime.ts. A declared-but-
 *      never-emitted event is dead protocol surface a host may wait on
 *      forever. (Found 3 today: agent_status_changed, runtime_error,
 *      task_started — allowlisted below.)
 *   2. consumer-list parity: the workspaces named in docs/contracts.md's
 *      "Known consumers" section vs the workspaces whose src/ actually
 *      import `pulse-coder-agent-teams`. Catches BOTH a listed non-consumer
 *      (the engine entry — a name collision with the orchestrator-based
 *      agent-teams-plugin, which does NOT import this package) and a real
 *      consumer the doc omits (packages/cli). docs/validation.md's engine
 *      escalation rule is built on the false engine entry.
 *
 * Run before touching the event union or the consumer/contract docs.
 * HARD ERROR (exit 1): a NEW un-emitted runtime event (beyond the allowlist),
 * or a contracts.md consumer that does not import the package. Missing-from-
 * doc real consumers print informationally (a doc omission, not a code bug).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = join(PKG, '..', '..');
const read = (p) => readFileSync(p, 'utf8');

// Known un-emitted runtime events (dead protocol surface, recorded not fixed).
const KNOWN_UNEMITTED = new Set(['agent_status_changed', 'runtime_error', 'task_started']);

// ── 1. runtime event-type ↔ emit parity ─────────────────────────────────────
const rtTypes = read(join(PKG, 'src', 'runtime', 'types.ts'));
const unionBlock = rtTypes.match(/export type TeamEventType =([\s\S]*?);/)?.[1] ?? '';
const declared = new Set([...unionBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
const runtimeSrc = read(join(PKG, 'src', 'runtime', 'team-runtime.ts'));
const emitted = new Set(
  [...runtimeSrc.matchAll(/\.emit\([^,]+,\s*'([a-z_]+)'/g)].map((m) => m[1]),
);
const unemitted = [...declared].filter((t) => !emitted.has(t)).sort();
const unexpectedUnemitted = unemitted.filter((t) => !KNOWN_UNEMITTED.has(t));
const staleUnemittedAllowlist = [...KNOWN_UNEMITTED].filter((t) => !unemitted.includes(t));

// ── 2. consumer-list parity ─────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
  }
  return out;
}
const wsDirs = [];
for (const group of ['apps', 'packages']) {
  const base = join(REPO, group);
  if (!existsSync(base)) continue;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (e.isDirectory()) wsDirs.push([`${group}/${e.name}`, join(base, e.name, 'src')]);
  }
}
const realConsumers = new Set();
for (const [name, src] of wsDirs) {
  if (name === 'packages/agent-teams') continue; // self
  if (walk(src).some((f) => /pulse-coder-agent-teams/.test(read(f)))) realConsumers.add(name);
}
const contracts = read(join(PKG, 'docs', 'contracts.md'));
const consumerSection = contracts.match(/Known consumers[\s\S]*?(?=\n##|$)/)?.[0] ?? '';
// Only bullet-list entries are declared consumers; prose mentions (e.g. a
// NOTE explaining a NON-consumer) must not count, so match `- `<ws>`` lines.
const listedConsumers = new Set(
  [...consumerSection.matchAll(/^-\s+`(apps\/[a-z-]+|packages\/[a-z-]+)`/gm)].map((m) => m[1]),
);
const listedButNotReal = [...listedConsumers].filter((c) => !realConsumers.has(c)).sort();
const realButNotListed = [...realConsumers].filter((c) => !listedConsumers.has(c)).sort();

// ── output ───────────────────────────────────────────────────────────────────
const hardErrors = unexpectedUnemitted.length + listedButNotReal.length;
const snapshot = {
  runtimeEvents: {
    declared: declared.size,
    emitted: emitted.size,
    unemitted,
    knownUnemitted: [...KNOWN_UNEMITTED],
    unexpectedUnemitted,
    staleAllowlist: staleUnemittedAllowlist,
  },
  consumers: {
    real: [...realConsumers].sort(),
    listedInContracts: [...listedConsumers].sort(),
    listedButNotReal,
    realButNotListed,
  },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(hardErrors ? 1 : 0);
}

console.log('# agent-teams structure snapshot\n');
console.log(`## Runtime events (${declared.size} declared · ${emitted.size} emitted)`);
if (unexpectedUnemitted.length) {
  console.log(`  !! declared in TeamEventType but NEVER emitted (dead protocol surface): ${unexpectedUnemitted.join(', ')}`);
} else {
  console.log('  every declared event is emitted somewhere (modulo the known-unemitted allowlist).');
}
if (unemitted.filter((t) => KNOWN_UNEMITTED.has(t)).length) {
  console.log(`  known-unemitted (declared, no emit site — recorded not fixed): ${unemitted.filter((t) => KNOWN_UNEMITTED.has(t)).join(', ')}`);
}
if (staleUnemittedAllowlist.length) {
  console.log(`  (info) KNOWN_UNEMITTED stale (now emitted) — prune: ${staleUnemittedAllowlist.join(', ')}`);
}

console.log(`\n## Consumers (${realConsumers.size} import the package)`);
console.log(`  real importers: ${[...realConsumers].sort().join(', ')}`);
if (listedButNotReal.length) {
  console.log(`  !! listed in contracts.md "Known consumers" but do NOT import the package (false blast-radius — see security/contract note): ${listedButNotReal.join(', ')}`);
}
if (realButNotListed.length) {
  console.log(`  (info) import the package but NOT listed in contracts.md — doc omission: ${realButNotListed.join(', ')}`);
}

process.exit(hardErrors ? 1 : 0);
