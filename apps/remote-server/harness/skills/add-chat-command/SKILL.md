---
name: add-chat-command
description: Use when adding a slash command to remote-server's chat-command router. Covers the ~6 parallel registries that must stay in sync, the COMMANDS_ALLOWED_WHILE_RUNNING active-run-race decision, and the describe-remote-server passthrough parity check.
---

# Add a Chat Command

An ordered procedure. The one real hazard is that a command's definition is
spread across ~6 parallel registries and nothing but this skill (plus one
parity check) keeps them in sync. FACTS live in the cited files.

## Steps

1. **Snapshot parity first.** `node harness/tools/describe-remote-server.mjs` — the "Chat commands (N server-side · M Discord passthrough)" line and any "missing from passthrough" hard error are your baseline.

2. **Add the handler** under `src/core/chat-commands/handlers/` (9 exist) and wire the `case '<cmd>':` in the router switch (`src/core/chat-commands.ts`, ~22 cases).

3. **Update every parallel registry it belongs to** — this is the landmine; each is a separate file and a miss is silent:
   - `COMMAND_ALIASES` in `command-defs.ts` if the command has short forms.
   - **`COMMANDS_ALLOWED_WHILE_RUNNING`** in `command-defs.ts` — see step 4, this is a correctness decision, not a formality.
   - **Discord `PASSTHROUGH_SLASH_COMMANDS`** (`adapters/discord/adapter.ts:636`) AND the registration in `application-commands.ts` — a command absent from passthrough is unreachable as a Discord slash command (describe-remote-server hard-errors on this).
   - `help.ts` so `/help` lists it.
   - README's Slash Commands table.

4. **`COMMANDS_ALLOWED_WHILE_RUNNING` is an active-run-race decision.** Commands in that set bypass the per-`platformKey` active-run guard (`chat-commands.ts` → runs even while a turn is in flight). That is correct for read-only/control commands (`/stop`, `/status`) but DANGEROUS for anything that mutates shared session/worktree state: `/fork` and `/wt` are in the set and can orphan or redirect an in-flight run (`harness/knowledge/known-defects.md §5`). Read `core-lifecycle.md` invariant 1 before adding a state-mutating command here — default is NOT to add it to the allowed-while-running set.

5. **Clarification interaction.** If a run can be mid-clarification, remember the next inbound message is consumed as the clarification answer (`known-defects.md §3`) — a command typed then may be swallowed, not executed. Don't design a command whose only escape hatch is typing it during a clarification.

6. **Verify.** `node harness/tools/describe-remote-server.mjs` (no new missing-from-passthrough); `build` + `test`.

## Done when

The switch case + handler exist; every registry it belongs to is updated (aliases, help, README, Discord passthrough + application-commands); the allowed-while-running decision is conscious and safe; describe-remote-server shows no passthrough drift; build + test green.
