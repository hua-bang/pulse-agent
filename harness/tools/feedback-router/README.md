# Feedback Router Tool

## Purpose

Route feedback to the right proposal target and long-term source of truth.

## Inputs

- Feedback text.
- Source: user correction, review, validation failure, runtime incident, CI failure, or report.
- Evidence paths or logs.
- Affected workspace candidates.
- `harness/README.md` knowledge routing rules and affected workspace entry.

## Output

- admission level: A, B, C, or D
- semantic scope
- recommended long-term target
- proposal path suggestion
- missing evidence
- mechanism candidate: test, check, hook, CI, docs, or skill

## Non-goals

- Does not make final governance decisions.
- Does not leave accepted long-term knowledge in `harness/feedback` only.
