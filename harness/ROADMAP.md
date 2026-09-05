# Harness Optimization Roadmap

> Implementation roadmap for the repository harness. Status: P1–P7 implemented and locally verified; review findings resolved. Publication and the first remote CI run remain pending. Updated 2026-09-05.
> The architecture and ownership model remain in [DESIGN.md](DESIGN.md); [README.md](README.md) is the navigation entry. This file owns delivery order, scope, and acceptance.

## Outcome

Make every repository task start with clear constraints and find the right knowledge, run checks against the current change, and report exactly what has and has not been verified. Preserve the existing model:

```text
Root AGENTS.md -> workspace AGENTS.md -> task-triggered harness resources
                                           |
                         Knowledge / Tools / Validate / Skills
                                           |
                         Source + types + executed evidence
                                           |
                         Acceptance + write-back to the owner
```

Root AGENTS.md stays the highest project-rule layer under the repository's declared precedence. It keeps global constraints and mandatory routing. Detailed knowledge stays with its workspace; live facts remain owned by manifests, source, and executable checks. Spec stays optional, with the meaning defined in DESIGN.md.

## Starting foundation and delivered improvements

| Surface | Starting foundation | Delivered improvement |
|---|---|---|
| Entry | Root and active-workspace AGENTS files; thin CLAUDE import shells | Root, Canvas, and CLI entries are slimmer task routers with required owner links. |
| Knowledge | Workspace contracts, architecture, known defects, failure guards | Moved detail stays with its owner; stale facts are corrected; deep link diagnostics distinguish history/runtime references. |
| Tools | Manual runner, structural drift checker, workspace describe tools, Canvas driver | Shared schema/reference inspection, correct execution directories/prerequisites, and regression fixtures. |
| Validate | Local path rules, root overlay, tiered Canvas checks | Tested dependency/performance routing and versioned evidence reports with outstanding manual work. |
| Skills | Existing root/workspace action protocols | Existing slimming and visualization protocols remain the entrypoints. |
| Automation | Canvas performance GitHub Actions workflow | Qualified harness-integrity workflow added; ordinary workspace acceptance remains manual. |

The repaired starting defects were two workspace-relative descriptor commands, the engine descriptor's unbound build prerequisite, performance classification using former renderer directories, and the unbound lockfile path. The former drift check could pass despite these defects. Full conversation/audit dumps do not belong in this roadmap.

## Delivery order

| Phase | Deliverable | Depends on | Focused effort | Completion condition |
|---|---|---|---|---|
| P1 (done) | Root AGENTS optimization | Existing harness | 0.5 day | Root carries necessary constraints and task routes; owned knowledge and mandatory guards remain reachable. |
| P2 (done) | Repair existing validation execution | P1 delivery order | 0.5–1 day | Execution regressions and a clean-snapshot engine build/descriptor pass. |
| P3 (done) | Shared rule reader and harness self-checks | P2 | 1–1.5 days | Configuration/reference regression tests pass; the frozen lockfile validates. |
| P4 (done) | Change routing and impact coverage | P3 | 1–1.5 days | Workspace/rename/path cases and the real workflow classifier are tested. |
| P5 (done) | Evidence reports and focused escalation | P3–P4 | 0.5–1 day | Reports distinguish execution states and preserve outstanding manual evidence. |
| P6 (done) | Workspace context and knowledge maintenance | P1, P3 | 1–1.5 days | Canvas/CLI entries follow content ownership and disclosure principles; deep diagnostics have exception fixtures. |
| P7 (done locally) | Qualified harness CI | P2–P6 and replay gate | 0.5 day + observation | Ten representative plans and fault-injection tests pass; the first remote workflow run awaits publication. |

Recommended order is P1 through P7. Each phase must be independently mergeable and useful if later work stops. P2 follows P1 promptly; broader document cleanup must not delay known execution repairs.

- **Milestone 1 — usable entry and checks:** P1–P2. This is the minimum first delivery.
- **Milestone 2 — trustworthy validation:** P3–P5. Configuration, change selection, and evidence reporting form one understandable workflow.
- **Milestone 3 — sustainable maintenance:** P6–P7. Context stays manageable and qualified checks run automatically.

P1–P6 was estimated at 5–8 focused working days for one maintainer familiar with the repository, excluding review and long application checks. The full scope exceeds eight files. Estimates were planning ranges, not scheduled deadlines. P1–P7 have passed local verification and the final review findings are resolved. Remote workflow execution is not claimed before publication.

## P1 — Optimize the root AGENTS entry first

**Primary owner:** root AGENTS.md, with minimal edits to existing indexes and subject-workspace Knowledge files needed to preserve content.

Keep directly visible: precedence, SSOT ownership, essential hard boundaries, required reading/validation, security and runtime-data boundaries, the auxiliary-workspace exception, and task-end write-back. Keep concise global or cross-workspace failure guards.

Apply `harness/skills/slim-agents-md/SKILL.md`:

1. Classify each existing instruction as a global constraint, task route, owned detail, or independently verified stale claim.
2. Move module-specific mechanisms and long failure histories to their existing topic owners. If the content already exists there, remove the repeated root prose and retain its route.
3. Consolidate navigation and prerequisite tables around **task/trigger -> required reading or tool -> acceptance destination**. Reading a linked document is required when its trigger matches.
4. Preserve every removed requirement through a fact-preservation audit. Resolve source-verified stale claims explicitly; flag uncertain claims rather than silently rewriting them.
5. Check section/anchor references in downstream docs when reorganizing root sections. Root harness/knowledge remains an index.

Use the content-admission principles in DESIGN.md to decide what remains in the entry. Preserve necessary constraints, remove duplicate explanations, and keep owned knowledge reachable. Character counts describe context cost only.

**Acceptance:** routes for engine plugins/tools, Canvas shortcuts, cross-package changes, validation, and harness maintenance resolve to the correct owner. Every removed instruction is accounted for. Run the bound documentation check and manually inspect references outside the checker's current coverage. Workspace entry slimming and checker implementation remain later phases.

## P2 — Repair execution before adding more checks

**Primary files:** agent-teams, remote-server, and engine local validation YAML; `scripts/harness/run-harness-check.test.mjs`.

- Correct the agent-teams and remote-server descriptor commands to use repository-relative script paths. Keep the runner's execution directory at repository root; do not add per-rule working-directory settings for these two mistakes.
- Bind the engine's actual package build and descriptor as one ordered build-and-check step. Build failure must prevent descriptor execution; independent checks retain the runner's collect-all-failures behavior.
- Use the real package build entry. `packages/engine/tsup.config.ts` sets `dts: true`; SKIP_DTS alone must not be assumed to disable declarations.
- Extend runner tests with temporary fixture repositories and harmless executable commands. Test working directory, failure exit status, command ordering, and failed prerequisites.
- Run the corrected agent-teams and remote-server descriptors directly. Verify the engine sequence once from a disposable checkout without dist. Keep unit fixtures independent of plugin initialization and live application state.

**Acceptance:** the former MODULE_NOT_FOUND cases pass with the exact bound commands; missing build output is prepared; a failed build never runs its descriptor; an executed check failure produces a nonzero runner exit. Dry-run text assertions alone do not satisfy this phase.

## P3 — Give harness data one reader and explicit checks

**Primary files:** `scripts/harness/run-harness-check.mjs`, `scripts/harness/check-harness.mjs`, root validation overlay, root package metadata and lockfile.

Future shared implementation and tests: `scripts/harness/validation-data.mjs`, `scripts/harness/validation-data.test.mjs`, and `scripts/harness/check-harness.test.mjs`.

The shared module owns workspace discovery, validation loading, schema checks, and path matching. Both entrypoints consume it; avoid two interpretations of the same files. The root yaml 2.8.2 dependency replaces the retired `scripts/harness/simple-yaml.mjs`. This trades dependency-free inspection for a smaller parser maintenance burden; missing installation produces a clear error, not a fallback parser.

Keep validation version 1 and existing command strings. Check:

- YAML syntax and duplicate keys; unique rule names; recognized fields and field types.
- Nonempty command strings; valid paths and command-tier shapes; valid manual/optional and release-only rules.
- Workspace membership from pnpm-workspace.yaml; unsupported discovery patterns fail explicitly.
- Repository-relative Node script targets and real named package scripts.
- Concrete file/directory arguments in focused Vitest commands, without claiming that existence proves behavioral coverage.

Support the simple command forms used by the repository, including P2's ordered build/check step. Mark unsupported shell forms as **uninspected**. Structural inspection never executes arbitrary configured commands. Permit optional path selectors on escalation rules for P5.

Broaden the root harness-tool rule so shared reader, checker, runner, and related test changes execute the complete focused harness suite.

**Acceptance:** all existing validation files load; deleting a script, misspelling a package script or schema field, adding a duplicate key, or corrupting a command tier fails before execution. Valid optional/release-only cases stay valid. Structural errors and uninspected commands are reported separately. harnessGaps remains a structural metric.

## P4 — Test the change-to-check contract

**Primary files:** shared reader and runner/tests, root validation overlay, `.github/workflows/perf.yml`, `apps/canvas-workspace/scripts/perf/report-policy.mjs` and its adjacent test.

### Changed paths

Use NUL-delimited Git status/diff records. Include both sides of renames when selecting workspace impact. Keep --since scoped to the committed ref-to-HEAD comparison; do not silently include uncommitted work.

Normalize explicit repository paths. Expand directories from tracked and nonignored untracked Git files, avoiding recursive dependency/build/runtime-directory traversal. Keep explicit deleted paths usable. Positive live-repository fixtures must assert their targets exist; deleted-file behavior gets separate fixtures.

### Root and consumer impact

Bind pnpm-lock.yaml to root configuration validation. Keep existing core build/test commands and explicitly include Canvas typecheck/test for root dependency/configuration acceptance. Ordinary workspace source changes retain local selection. Root legacy rules remain untiered until measured cost justifies changing them.

This is deliberately conservative for shared dependencies across the current workspace set. If it proves too expensive, use P5's duration evidence before adding dependency-based filtering. Membership/dependency data must continue to come from pnpm and package manifests.

### Performance impact

Move the workflow's shell path classification into the existing performance report-policy module and have the workflow call it. Replace former renderer paths with current app/App, app/shell/Workbench, and modules/canvas paths; preserve main-process, performance-tool, label, dispatch, and default-branch behavior.

Include root package/workspace/lockfile changes in workflow event filtering and runtime/package compatibility classification. Keep an ordinary localized settings UI change on the bundle-only path. Add a root binding that runs policy tests when the workflow changes.

Local release validation intentionally covers more source paths than selective CI. Preserve that distinction rather than merging different policies into one misleading glob list.

**Acceptance:** the following matrix is executable test coverage for the planner/policy, with positive and negative selection assertions.

| Change case | Required behavior |
|---|---|
| One source change in each active workspace | Select that workspace's expected checks. |
| Cross-workspace rename | Consider both owners. |
| Deleted source; spaces or CJK in paths | Preserve and classify the path correctly. |
| Directory containing ignored generated files | Avoid traversing dependencies and runtime homes. |
| Lockfile-only or shared root configuration | Include core and Canvas acceptance. |
| Current Canvas, Workbench, IframeNodeBody | Select runtime-sensitive performance checks. |
| Ordinary settings UI | Keep bundle-only CI behavior. |
| Documentation-only input | Report the appropriate structural or explicit no-checks scope. |

## P5 — Report evidence scope and remaining work

**Primary files:** runner/tests, root escalation rules, `harness/validate/README.md`, engine validation guidance.

Add optional **--report <path>** output. Its versioned JSON records timestamp, HEAD, dirty-worktree status, path source, selected level, affected paths, commands and selection reasons, execution directory, exit codes/durations, unmatched paths, and outstanding manual/escalation work. Keep text output as the default.

Reports are generated artifacts and never cached proof. HEAD plus dirty status is not an immutable snapshot of uncommitted content.

| Outcome | Required meaning |
|---|---|
| planned | The command was selected; execution has not occurred. |
| passed / failed | The selected command actually completed with that result. |
| no-checks | No executable check applies to an explicitly identified scope. |
| deferred-by-level | A rule matched, but its checks belong to a higher level. |
| manual / escalation outstanding | Further acceptance work remains; it was not executed by the runner. |

Exit 2 for invalid input/configuration or unmatched managed source/package/build/test configuration; exit 1 for executed check failures. Exit 0 means selected automatic checks succeeded or an explicitly labelled document/auxiliary no-checks case. A release-only rule at quick is deferred, not an unmatched-path failure. Outstanding manual evidence remains visible after automatic success.

Add optional path selectors to the existing escalation rules, using the owning contract guidance for engine public/plugin surfaces, built-ins, core/context/AI lifecycle, tool contracts, agent-teams runtime protocol, and plugin-kit public/source surfaces. Show the matching reason and suppress irrelevant workspace-wide reminders. Semantic public-API judgments remain manual.

**Acceptance:** mixed pass/fail, dry-run, empty plans, quick against release-only rules, and outstanding manual work produce distinguishable reports. Preserve quick for iteration, standard for functional completion, and release/manual evidence for the relevant performance or live-app scenario.

## P6 — Maintain workspace context and knowledge

**Primary files:** Canvas/CLI AGENTS entries, their existing topic Knowledge, plugin-kit test/build guidance, checker/tests, harness knowledge/validation indexes.

### Entrypoints and ownership

Apply the existing slimming protocol to Canvas and CLI after the root pass. Prioritize mechanism-heavy sections and repeated test/build inventories. Correct dynamic claims against current source, including plugin-kit goal-test coverage, and use owner pointers for facts that would otherwise be copied.

Apply DESIGN.md's content-admission principles to every entry update: decision value, narrow ownership, one source of truth, progressive disclosure, actionable evidence, and rule lifecycle. Acceptance depends on those properties and preservation of valid constraints.

Complete-entry and reading-chain lengths remain informational. There are no length ceilings, growth baselines, or rewrite quotas for AGENTS.md. The checker continues to block objective reference/configuration failures. Do not expand every small workspace into a directory template.

### Deep-document diagnostics

The delivered **--deep-docs** mode starts with explicit Markdown file links in workspace Knowledge/Skills and file existence for source citations carrying line suffixes. Resolve by document/workspace ownership. Treat ambiguous prose references as warnings.

Preserve the previously measured false-positive cases as fixtures before expanding coverage:

- Runtime-created .pulse-coder config/plugin/image artifact paths, while still checking tracked configuration paths.
- Historical or deleted references, including the hyphenated non-existent wording.
- Deleted-spec history links, code examples, and external URLs.

The earlier extension probe produced mostly false positives; widening the current keyword-skip scanner unchanged is not acceptable. Report new deep-document warnings separately until calibrated. A model-generated semantic score is outside this phase.

**Acceptance:** every moved constraint and failure guard stays reachable; removed text is accounted for; targeted entries shrink; verified stale facts are corrected at their owners; genuine broken explicit links are detected; runtime/history fixtures do not become hard failures.

## P7 — Add qualified harness automation

**Primary owner:** GitHub Actions and the existing manual harness entrypoints.

Qualification gate: replay one representative change set per active workspace plus root-dependency and documentation cases (ten cases for today's workspace set), with zero confirmed false positives. Demonstrate that P2–P4's injected command/schema/routing failures are caught. Record evidence in the implementing PR; elapsed time alone does not satisfy this gate.

Workflow: `.github/workflows/harness.yml`.

- Trigger on harness/script/entrypoint/workspace-metadata/lockfile changes and test/spec paths, so moving a test target can expose a stale binding even when its YAML was not edited.
- Reuse the pnpm and Node setup choices already used by performance CI. Install locked dependencies without native package lifecycle scripts.
- Run structural drift checks, focused harness tests, and --all --dry-run.
- Keep actual application performance/package checks in existing performance CI. Broad business-test CI, pre-push hooks, and branch-protection policy are separate decisions.
- Update claims about automation in root AGENTS and harness README/Validate/roadmap only when this workflow lands.

**Acceptance:** a broken binding fails CI; healthy changes pass without launching Electron, accessing user runtime state, or requiring service credentials. The manual entrypoints continue to work if the workflow is disabled or reverted.

## Verification, handoff, and maintenance

Before each implementation PR, re-read the affected workspace entries and current validation rules. Recheck the known starting condition; do not overwrite unrelated work already in the tree.

Use the existing commands as applicable:

```bash
node scripts/harness/check-harness.mjs
pnpm exec vitest run scripts/harness harness/skills/visualize-harness/scripts/render-harness-graph.test.mjs
node scripts/harness/run-harness-check.mjs --all --dry-run
node scripts/harness/run-harness-check.mjs --level standard --dry-run
```

Execute the checks selected for the changed paths, not just their plan. For Canvas performance-policy changes, also run:

```bash
pnpm --filter canvas-workspace exec vitest run scripts/perf/report-policy.test.mjs
```

Root dependency/config changes use the root-overlay checks, including Canvas acceptance once P4 lands; include Canvas explicitly before then. Pure Markdown changes require their bound documentation checks and reference/fact preservation, not a new application test suite.

Every PR reports its completed acceptance criteria, commands actually run, unverified scope, and relevant durations. Capture new stable facts in the owning Knowledge file, new checks in the owning validation file, and repeated workflows in an existing Skill before creating another. Run evidence belongs in PRs/logs/generated artifacts. Update phase status here as work lands; keep this roadmap focused on remaining decisions and delivery.

All changes are reversible code/config/document edits with no user-data migration. The only proposed dependency change is a direct root declaration of the repository's existing YAML library. No new account, API key, service, runtime skill, or product-runtime rewrite is required. Missing installation, cold-build failures, and unrelated application failures are reported honestly; bindings must not be weakened to manufacture green results.

## Deferred work and extension criteria

| Work | Revisit when |
|---|---|
| Pre-push hook or broad business-test CI | The small workflow is stable and there is evidence it misses the actual delivery path. |
| Dependency-graph filtering or result caching | Measured check cost is material; manifests can supply dependencies and cache invalidation can prove input identity. |
| Semantic contradiction/test-effectiveness automation | A repeated failure class has a narrow, testable rule and calibrated false positives. |
| Existing ambiguous source citations | Qualify shorthand when editing the owning Knowledge file; deep diagnostics remain separate from structural failures. |
| More harness services, dashboards, or generic routing tools | Existing scripts/indexes cannot carry a recurring task with acceptable complexity. |
| Node pinning, lint/format toolchain, additional governance mandates | Reproducible compatibility or maintenance problems justify their separate scope. |

## Completed foundation

The original keystone phase 1 established workspace-local YAML and the root overlay, executed by the manual runner with changed-path, range, explicit-path, all, and dry-run modes. The completed P1–P7 optimization cycle builds on that foundation.

Keep the lessons from that work:

- A declared required command can have been broken since its first version; execute it before trusting the binding.
- Doc-rich workspaces benefit from correcting and relocating existing knowledge before adding more documents.
- Root/workspace ownership and the separation from product runtime skills must survive every refactor.
- False-positive calibration precedes automatic enforcement; a structural pass does not prove semantic correctness.
- Existing visualization and cross-workspace Canvas capability protocols remain reusable assets.
