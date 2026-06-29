---
name: feedback-governance
description: Convert user corrections, review findings, validation failures, and runtime incidents into routed repository knowledge or mechanisms.
---

# Feedback Governance Skill

## Trigger

Use this when someone says the agent was wrong, a rule is missing, existing docs conflict with code, validation failed in a reusable way, or a lesson should be remembered for this repository.

## Boundary

Feedback is a flow, not a permanent knowledge type. This skill owns admission, routing, proposal shape, and verification. Long-term facts belong in the selected SSOT.

## Admission

| Level | Meaning | Default action |
|---|---|---|
| A | Repeated, high-risk, or correctness-affecting | Propose repository change. |
| B | Single but reusable with evidence | Propose or record with scope. |
| C | Possibly useful, evidence or scope unclear | Put in inbox with missing evidence. |
| D | One-off or personal preference | Do not change repo facts by default. |

## Steps

1. Capture source, evidence, current task context, and affected paths.
2. Classify A/B/C/D.
3. Use `harness/tools/feedback-router`, `harness/README.md` knowledge routing, and the affected workspace entry to pick a target.
4. Write a feedback proposal before changing repository knowledge.
5. Route accepted facts to the long-term source: workspace contracts, app spec/history, runbook, validation, harness skill, checks, tests, or root entry.
6. Leave only unresolved or under-evidenced items in `harness/feedback/inbox.md`.

## Output

- Feedback Proposal summary.
- Admission level and evidence.
- Chosen target and why alternatives were not used.
- Validation plan and remaining risk.

## Validation

- Long-term knowledge is not left only in `harness/feedback`.
- Project rules are not written to personal or runtime memory.
- Mechanizable issues identify a test/check/hook candidate.
