# Harness Skills

`harness/skills` is the source of truth for repository-level action protocols. These files are tool-agnostic; they are not runtime skills for `.pulse-coder` unless a future adapter explicitly references or generates them.

Each skill should define:

- trigger
- boundary
- required inputs
- steps
- output
- validation
- references

## Current Skills

| Skill | Use |
|---|---|
| `doc-governance.md` | Add or adjust repository/workspace documentation without creating duplicate facts. |
| `feedback-governance.md` | Turn feedback into a proposal and route accepted facts to the right SSOT. |
| `quality-workflow.md` | Pick validation depth and collect evidence for a change. |
| `code-review.md` | Review diffs with repo-aware routing and validation expectations. |
| `contract-coding.md` | Change package/runtime contracts without drifting from types, tests, and docs. |
