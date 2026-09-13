---
name: fix-pulse-agent-issue
description: Diagnose and implement a verified fix for one Pulse Agent GitHub issue in the pulse-agent repository.
description_zh: 在 pulse-agent 仓库中诊断并修复一条指定的 GitHub issue。
disable-model-invocation: true
version: 1.1.0
author: Pulse Coder Team
---

# Fix Pulse Agent Issue

This is a user-invoked skill. Run it only when the user explicitly names `fix-pulse-agent-issue` and supplies an issue number or URL. Invoking it authorizes repository edits and validation for that issue, but not commit, push, PR creation, deployment, or closing the issue unless the same request explicitly asks for those actions.

## Target gate

Work only in a checkout whose `origin` resolves to `hua-bang/pulse-agent`.

Start with:

```bash
pwd
git remote get-url origin
git status --short
git branch --show-current
```

Normalize HTTPS and SSH forms and require the origin path to be exactly `hua-bang/pulse-agent` with an optional `.git` suffix. If the repository is wrong, stop. If the worktree contains unrelated or uncertain changes, preserve them and stop before editing unless the task can be isolated without touching or including them.

Completion criterion: the repository identity is verified and the issue work can proceed without overwriting or absorbing unrelated user changes.

## Workflow

### 1. Read the issue as evidence

Fetch the issue without relying on a paraphrase. If the input is a URL, first require its owner and repository path to be exactly `hua-bang/pulse-agent`; reject URLs for any other repository.

```bash
gh issue view <number-or-verified-url> --repo hua-bang/pulse-agent \
  --json number,title,body,state,labels,comments,url
```

If the issue is closed, continue only when the user explicitly wants a regression or follow-up fix. Extract:

- observable failure;
- expected behavior;
- reproduction path;
- affected surface;
- acceptance evidence;
- hypotheses that still need verification.

Ask at most one focused question only if no testable outcome can be inferred.

Completion criterion: produce a short executable brief with a falsifiable failure and acceptance condition.

### 2. Load repository guidance

Read root `AGENTS.md`, `harness/README.md`, the affected workspace `AGENTS.md`, and its local validation. Follow every task-matched route before editing. Read only files directly required by the issue.

Completion criterion: the owning workspace, constraints, affected contracts, and required checks are identified.

### 3. Reproduce before fixing

Prefer the smallest deterministic reproduction:

1. existing focused test;
2. new regression test;
3. focused command or app harness scenario;
4. logs or code-path proof only when execution is unavailable.

Do not treat the issue description alone as root-cause proof. Use `git log -- <file>` when regression history matters.

Completion criterion: the failure is reproduced, or the exact reason reproduction is unavailable is recorded with the strongest substitute evidence.

### 4. Diagnose the root cause

Trace from the observed failure to the owning boundary. Distinguish:

- root cause;
- contributing condition;
- symptom;
- unrelated nearby defect.

Prefer an existing module, hook, plugin, tool, service, script, or guard. Do not broaden scope merely because adjacent cleanup is attractive.

Completion criterion: the proposed change explains why the reproduction fails and why the chosen boundary owns the fix.

### 5. Implement the smallest complete fix

Preserve existing contracts and failure guards unless the issue explicitly requires changing them. Add or update a regression test for behavior changes. Do not modify unrelated dirty files, generated output, credentials, or user runtime data.

Completion criterion: the reproduction turns green, the acceptance condition is met, and every modified file is necessary to the fix or its verification.

### 6. Validate

Run focused checks first, then the repository acceptance runner scoped with explicit affected paths:

```bash
node scripts/harness/run-harness-check.mjs --level standard --path <affected-paths>
```

When Canvas is affected, include its local checks because root core build/test excludes it. For harness edits, also run:

```bash
node scripts/harness/check-harness.mjs
```

Report failures caused by the change separately from unrelated or environment-blocked checks. Never claim an unrun check passed.

Completion criterion: required checks pass, or each remaining failure is named with command output and impact.

### 7. Review and report

Inspect only the task diff:

```bash
git diff --stat -- <affected-paths>
git diff -- <affected-paths>
```

Report:

```md
Issue: #<number> <url>
Root cause: <verified cause>
Fix: <what changed>
Regression coverage: <test or scenario>
Validation: <commands and results>
Remaining risk: <unverified scope or none>
```

Do not close the issue directly. If the user also explicitly requested commit/push/PR handoff, use the repository's existing git/MR workflow and inspect CI for the pushed HEAD before reporting completion.

Choose the PR linkage from the verified scope:

- For a complete fix that satisfies the issue's acceptance condition, include `Fixes #<number>` in the PR body. This is the default for successful runs of this skill and lets GitHub close the issue when the PR merges into the default branch.
- For a partial fix, investigation, prerequisite, or follow-up that does not fully resolve the issue, include `Related to #<number>` instead. Never use a closing keyword merely because the PR mentions the issue.
- For an issue URL, resolve its number after verifying the repository and use the same keyword form.

Report the selected linkage explicitly:

```md
Issue linkage: Fixes #<number>
```

or:

```md
Issue linkage: Related to #<number>
Reason not closing: <remaining acceptance gap>
```

Completion criterion: the worktree contains a reviewable issue-scoped fix with reproducible evidence, and any requested PR uses the correct closing or non-closing linkage; otherwise the blocker is stated precisely without a false completion claim.
