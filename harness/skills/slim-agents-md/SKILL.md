---
name: slim-agents-md
description: Refine root or workspace AGENTS.md when it contains implementation detail, duplicate rules, or outdated guidance. Move valid knowledge to its owner while preserving necessary constraints and task routes.
---

# Slim an AGENTS.md

Restore clear content ownership in a root or workspace entry. Keep necessary constraints and routes discoverable; place detailed knowledge, procedures, and executable acceptance at their existing owners.

The admission criteria live in [harness/DESIGN.md](../../DESIGN.md), under Content Admission and Maintenance. Root `AGENTS.md` supplies the governing write-back rule. This protocol applies those principles during extraction; it does not define another set of size limits.

## When to Use

- An entry explains implementation details that belong to a task-specific resource.
- Multiple entry clauses or documents maintain the same rule.
- A source change has made an entry claim or route stale.
- A maintainer asks to slim an entry or extract its inline knowledge.

Choose candidates by misplaced responsibility or demonstrated drift. Character counts may describe context cost, but they do not trigger extraction or determine whether it succeeded.

## Placement

| Content | Destination |
|---|---|
| A necessary constraint, prerequisite, acceptance boundary, or task-to-owner route | The narrowest owning AGENTS.md |
| Mechanism, rationale, edge case, or relevant failure history | The existing subject-workspace Knowledge or docs |
| Check selection and executable enforcement | Owning validation, test, type, or tool; route to it when the task requires it |
| Stable recurring procedure | An existing owning Skill, or a new protocol only when current entries cannot carry it |
| Source-verified obsolete guidance | Correct or retire it, recording the evidence in the change explanation |
| Uncertain claim or unresolved discrepancy | Qualify it in the owning resource and report the unresolved point |

The subject determines ownership. A root-entry paragraph about Canvas shortcuts belongs with Canvas knowledge. Root harness/knowledge remains an index; a move out of root AGENTS does not justify a new root-owned knowledge copy.

## Apply the Change

1. Read the target entry, its governing rules, and the existing subject resources. Preserve a copy of the pre-edit working-tree contents so unrelated uncommitted work remains part of the comparison.
2. For each candidate, identify the decision or constraint that must remain visible, the existing owner of its detail, and any enforcing check. Update an existing clause before adding a parallel one.
3. Verify concrete claims against source, manifests, or executable evidence. Preserve valid requirements, exceptions, failure guards, and rationale. Correct or retire claims only when evidence supports it; qualify unresolved claims rather than inventing a replacement.
4. Move the complete operational meaning to its owner. Reuse an existing section when it already carries the subject. Remove duplicate detail from the entry after confirming the owner carries it.
5. Leave the necessary constraint and a task-triggered route. For example:

   ```markdown
   | Changing keyboard shortcuts | Read `apps/canvas-workspace/harness/knowledge/keyboard-shortcuts.md` before changing registry bindings or menu accelerators. |
   ```

   Use the real owner path in the delivered row. Preserve mandatory reading when the trigger matches. If the owning resource already lists guards, route to it instead of maintaining another guard inventory. State missing enforcement honestly.
6. Review the resulting reading path: the agent must still be able to discover and apply every relevant constraint. Cosmetic wrapping, shortened labels, or an added link beside duplicated prose do not repair content ownership.

## Verify

- Compare with the pre-edit working-tree contents. Account for every removed requirement: retained at the entry, preserved at an owner, consolidated with equivalent guidance, or corrected/retired with independent evidence.
- Check routes and concrete source references, distinguishing current files from explicitly historical or runtime-created paths. Use the structural checker and manually inspect references outside its coverage.
- Run `node scripts/harness/check-harness.mjs`; require `harnessGaps: 0`. It checks objective entry/configuration/reference integrity. It does not judge the semantic eligibility of entry content.
- Run checks bound to the changed paths. Markdown-only extraction generally needs structural checks; changed executable behavior needs its relevant tests.
- Inspect only the intended diff. Describe any retired guidance and unresolved claims in the response or change description; no separate feedback store is needed.

## Done When

The entry carries necessary scoped constraints and task routes. Valid detail remains reachable at its owner, duplicated explanations have been consolidated, and obsolete guidance has been handled against evidence. Required checks pass and any unresolved claims are explicit.

Future task-end write-back follows the same admission principles: update the owning rule, keep the route useful, and retire guidance when its cause no longer applies.
