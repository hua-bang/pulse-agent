#!/usr/bin/env node
/**
 * describe-remote-server — static parity snapshot for apps/remote-server.
 *
 * Three mechanical drift checks whose inputs are all static string literals,
 * so extraction is robust (no runtime, no build):
 *
 *   1. env-var parity: every `process.env.NAME` referenced in src/ vs the
 *      keys documented in .env.example. Surfaces BOTH dead config
 *      (documented, never read — this is how the FEISHU_ENCRYPT_KEY /
 *      FEISHU_VERIFICATION_TOKEN security drift shows up mechanically) and
 *      undocumented live vars (read, never documented).
 *   2. chat-command registry parity: the `case '<cmd>':` labels in
 *      chat-commands.ts vs Discord's PASSTHROUGH_SLASH_COMMANDS set — a
 *      command handled server-side but absent from Discord passthrough is
 *      unreachable as a Discord slash command.
 *   3. mounted-routes snapshot: app.route/get/use mounts in server.ts,
 *      with commented-out (implemented-but-not-mounted) mounts listed.
 *
 * Run before touching env handling, the command router, or route mounts.
 * Exits non-zero ONLY on hard drift (see HARD ERRORS below); informational
 * drift (undocumented-but-used env, extra passthrough entries) prints but
 * does not fail — those are frequently legitimate.
 *
 * HARD ERROR (exit 1): a NEW server-side chat command missing from Discord
 * passthrough (beyond the allowlisted-known set). This is the one check with
 * a low false-positive rate: a command handled server-side but absent from
 * passthrough is genuinely unreachable as a Discord slash command.
 *
 * Everything else is INFORMATIONAL (prints, never fails): dead-documented
 * env is dominated by legitimate dependency-consumed config (memory-plugin /
 * ACP / engine read keys this app documents for the operator but never
 * references in its own src/), so it cannot be a clean gate — the ONE
 * security-relevant subset (FEISHU_ENCRYPT_KEY / FEISHU_VERIFICATION_TOKEN,
 * which document a check verifyRequest() does not perform) is authoritatively
 * recorded in harness/knowledge/security-posture.md, not gated here.
 *
 * Allowlists carry the CURRENTLY-KNOWN drift with a reason so the tool is
 * green today and fails only on NEW drift; stale entries print as
 * informational — prune them.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(APP_ROOT, 'src');

// ── KNOWN drift allowlists (shrink-only; each needs a reason) ──────────────
// Documented env keys that are intentionally/knowingly unread today.
// FEISHU_ENCRYPT_KEY / FEISHU_VERIFICATION_TOKEN are the security finding:
// they DOCUMENT a Feishu signature check that verifyRequest() does not
// perform (see harness/knowledge/security-posture.md §1). Listed here so the
// tool is green, but their presence is itself the red flag the knowledge
// face records — do NOT remove them from .env.example to silence this; they
// come out when the verification is actually implemented.
const KNOWN_DEAD_ENV_KEYS = new Set([
  'FEISHU_ENCRYPT_KEY',
  'FEISHU_VERIFICATION_TOKEN',
]);
// Server-side commands not exposed as Discord slash commands. The first
// four are intentional; `mode` is a SUSPECTED gap the two-scanner pass
// flagged (usable server-side + Feishu, absent from Discord passthrough) —
// recorded not fixed (owner decision: document, don't patch). Remove `mode`
// from here when it is either added to passthrough or confirmed as a
// deliberate Discord exclusion.
const KNOWN_NON_PASSTHROUGH_COMMANDS = new Set([
  'merge', // worktree-merge, driven in-conversation not as a slash command
  'acp',   // agent-control-protocol toggle, feishu/internal oriented
  'memory',// memory subcommands, text-driven
  'start', // telegram-only greeting alias
  'mode',  // SUSPECTED GAP — see comment above
]);

// ── file walk ──────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|mts|cts|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const srcFiles = walk(SRC);
const read = (f) => readFileSync(f, 'utf8');

// ── 1. env-var parity ───────────────────────────────────────────────────────
const usedEnv = new Set();
for (const f of srcFiles) {
  for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) usedEnv.add(m[1]);
}
const envExample = read(join(APP_ROOT, '.env.example'));
const documentedEnv = new Set(
  [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);
const deadEnv = [...documentedEnv].filter((k) => !usedEnv.has(k)).sort();
const undocumentedEnv = [...usedEnv].filter((k) => !documentedEnv.has(k)).sort();
const unexpectedDeadEnv = deadEnv.filter((k) => !KNOWN_DEAD_ENV_KEYS.has(k));
const staleDeadAllowlist = [...KNOWN_DEAD_ENV_KEYS].filter((k) => !deadEnv.includes(k));

// ── 2. chat-command parity ──────────────────────────────────────────────────
const chatCommandsSrc = read(join(SRC, 'core', 'chat-commands.ts'));
const serverCommands = new Set(
  [...chatCommandsSrc.matchAll(/case\s+'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]),
);
const discordAdapterSrc = read(join(SRC, 'adapters', 'discord', 'adapter.ts'));
const passthroughBlock =
  discordAdapterSrc.match(/PASSTHROUGH_SLASH_COMMANDS[^\[]*\[([^\]]*)\]/s)?.[1] ?? '';
const passthrough = new Set([...passthroughBlock.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
const missingFromPassthrough = [...serverCommands]
  .filter((c) => !passthrough.has(c) && !KNOWN_NON_PASSTHROUGH_COMMANDS.has(c))
  .sort();
const stalePassthroughAllowlist = [...KNOWN_NON_PASSTHROUGH_COMMANDS].filter(
  (c) => passthrough.has(c) || !serverCommands.has(c),
);

// ── 3. mounted routes ───────────────────────────────────────────────────────
const serverSrc = read(join(SRC, 'server.ts'));
const mounted = [...serverSrc.matchAll(/^\s*app\.(route|get|use)\(\s*'([^']+)'/gm)].map(
  (m) => `${m[1]} ${m[2]}`,
);
const commentedMounts = [...serverSrc.matchAll(/^\s*\/\/\s*app\.(route|get|use)\(\s*'([^']+)'/gm)].map(
  (m) => `${m[1]} ${m[2]}`,
);

// ── output ───────────────────────────────────────────────────────────────────
// Only chat-command passthrough drift is a hard error (see header). Dead
// env is informational — dominated by dependency-consumed config.
const hardErrors = missingFromPassthrough.length;
const snapshot = {
  env: {
    used: usedEnv.size,
    documented: documentedEnv.size,
    deadDocumented: deadEnv,
    knownDead: [...KNOWN_DEAD_ENV_KEYS],
    unexpectedDead: unexpectedDeadEnv,
    undocumentedButUsed: undocumentedEnv,
    staleAllowlist: staleDeadAllowlist,
  },
  chatCommands: {
    serverSide: serverCommands.size,
    discordPassthrough: passthrough.size,
    missingFromPassthrough,
    staleAllowlist: stalePassthroughAllowlist,
  },
  routes: { mounted, commentedOut: commentedMounts },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(hardErrors ? 1 : 0);
}

console.log('# remote-server structure snapshot\n');
console.log(`## Env vars (${usedEnv.size} read in src · ${documentedEnv.size} in .env.example) — informational`);
const securityDead = deadEnv.filter((k) => KNOWN_DEAD_ENV_KEYS.has(k));
const otherDead = deadEnv.filter((k) => !KNOWN_DEAD_ENV_KEYS.has(k));
if (securityDead.length) {
  console.log(`  ⚠ security stub — documented but verifyRequest() does NOT read them (see security-posture.md §1): ${securityDead.join(', ')}`);
}
if (otherDead.length) {
  console.log(`  documented-but-unread in this src (mostly dependency-consumed: memory-plugin / ACP / engine): ${otherDead.join(', ')}`);
}
if (undocumentedEnv.length) {
  console.log(`  read in src but NOT in .env.example (undocumented knobs): ${undocumentedEnv.join(', ')}`);
}
if (staleDeadAllowlist.length) {
  console.log(`  (info) KNOWN_DEAD_ENV_KEYS stale (now read) — prune: ${staleDeadAllowlist.join(', ')}`);
}

console.log(`\n## Chat commands (${serverCommands.size} server-side · ${passthrough.size} Discord passthrough)`);
if (missingFromPassthrough.length) {
  console.log(`  !! handled server-side but MISSING from Discord passthrough (unreachable as a Discord slash command): ${missingFromPassthrough.join(', ')}`);
} else {
  console.log('  every server-side command is reachable via Discord passthrough (modulo the known-non-passthrough allowlist).');
}
if (stalePassthroughAllowlist.length) {
  console.log(`  (info) KNOWN_NON_PASSTHROUGH_COMMANDS stale (now in passthrough or no longer a command) — prune: ${stalePassthroughAllowlist.join(', ')}`);
}

console.log(`\n## Mounted routes (${mounted.length})`);
for (const r of mounted) console.log(`    ${r}`);
if (commentedMounts.length) {
  console.log(`  implemented but NOT mounted (commented in server.ts): ${commentedMounts.join(', ')}`);
}

process.exit(hardErrors ? 1 : 0);
