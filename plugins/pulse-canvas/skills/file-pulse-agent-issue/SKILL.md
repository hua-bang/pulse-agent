---
name: file-pulse-agent-issue
description: File a well-evidenced issue against the Pulse Agent GitHub repository.
description_zh: 向 Pulse Agent GitHub 仓库提交一条证据充分、可执行的 issue。
disable-model-invocation: true
version: 1.0.0
author: Pulse Coder Team
---

# File Pulse Agent Issue

This is a user-invoked skill. Run it only when the user explicitly names `file-pulse-agent-issue`. Naming the skill authorizes creation of one GitHub issue; it does not authorize code changes.

## Target

Always file against `hua-bang/pulse-agent`. The current working directory may be any project or no repository at all.

## Workflow

### 1. Establish the report

Extract from the conversation and available evidence:

- observed behavior;
- expected behavior;
- reproduction steps;
- frequency and impact;
- Pulse Canvas/Pulse Agent version when available;
- operating system and architecture when relevant;
- screenshots, logs, error text, or affected files when available.

Ask at most one focused question only when the issue would otherwise be impossible to understand or reproduce. Never invent missing evidence; label it `Not provided` or omit it.

Completion criterion: the observed and expected behavior are distinguishable, and another maintainer has a concrete first reproduction attempt.

### 2. Sanitize

Remove or redact secrets, tokens, credentials, private paths, personal data, and unrelated conversation content. Include logs only to the smallest useful extent.

Completion criterion: the proposed issue body contains no known sensitive value.

### 3. Check for duplicates

If `gh` is available and authenticated, search open issues using the most specific error text or behavior keywords:

```bash
gh issue list --repo hua-bang/pulse-agent --state open --limit 50 --search '<specific keywords>'
```

If a likely duplicate exists, show its URL and ask whether the user wants a new issue anyway. Do not add a comment to the existing issue unless explicitly requested.

Completion criterion: no likely duplicate was found, or the user explicitly chose to continue.

### 4. Draft the issue

Use a concise title in this form when practical:

```text
<area>: <observable problem>
```

Use this body, omitting sections that add no information:

```md
## Summary
<what is wrong and why it matters>

## Reproduction
1. <step>
2. <step>
3. <observed result>

## Expected behavior
<expected result>

## Actual behavior
<actual result>

## Environment
- Pulse version: <version or Not provided>
- OS/architecture: <value or Not provided>
- Relevant configuration: <sanitized value>

## Evidence
<minimal logs, screenshots, links, or error text>

## Additional context
<scope, regression status, frequency, workaround>
```

Do not prescribe an implementation unless evidence supports it. Separate confirmed facts from hypotheses.

Completion criterion: the title names the observable problem, and every factual claim in the body comes from user input or inspected evidence.

### 5. Create the issue

Write the body to a temporary file to avoid shell quoting problems, then run:

```bash
gh issue create \
  --repo hua-bang/pulse-agent \
  --title '<title>' \
  --body-file '<temporary-body-file>'
```

Do not assign labels, milestones, projects, or assignees unless the user explicitly requests them or the repository exposes an unambiguous required convention.

If `gh` is unavailable or unauthenticated, do not attempt alternate credential flows. Return the complete title/body draft plus the exact command the user can run.

Completion criterion: return the created issue URL, or an honest blocked result with a ready-to-submit draft.
