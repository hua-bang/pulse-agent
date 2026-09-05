# Repository Harness

Start with root AGENTS.md, then this index and the affected workspace's AGENTS.md. Follow only task-matched routes into local knowledge, tools, validation, and skills.

The architecture and ownership rules live in [DESIGN.md](DESIGN.md); delivery status and remaining work live in [ROADMAP.md](ROADMAP.md).

## Find the Owner

| Need | Source of truth |
|---|---|
| Global constraints, precedence, required reading | Root AGENTS.md; CLAUDE.md only imports it |
| Active workspace membership | pnpm-workspace.yaml |
| Package metadata and executable scripts | The owning package.json |
| Local role, contracts, architecture, failure guards | Workspace AGENTS.md and its harness/Knowledge or existing docs |
| Shared knowledge navigation | [knowledge/README.md](knowledge/README.md) |
| Check selection and evidence | Local validation YAML, then the [root overlay](validate/validation.yaml) and [validation guide](validate/README.md) |
| Executable harness mechanisms | [tools/README.md](tools/README.md); implementations under scripts/harness/ |
| Recurring repository actions | Existing root/workspace harness/skills protocols, routed from their AGENTS files |

Read the workspace's contracts before changing a shared interface. Read DESIGN.md before changing harness structure or governance. Root owns shared constraints and cross-workspace impact; workspace owners keep local implementation knowledge. Reuse existing entries before adding a file.

## Reading Layers

- L0: AGENTS.md, CLAUDE.md, and project README.md are entry/control surfaces.
- L1: this index, DESIGN.md, ROADMAP.md, root validation, and root docs topic indexes route shared material.
- L2: workspace AGENTS plus local harness/docs own package-specific facts and procedures.

The model is AGENTS.md + Knowledge + Tool + Validate + Skills. Spec is optional intended behavior, defined in DESIGN.md. These names do not require boilerplate directories or READMEs; add a surface index only when real navigation cost justifies it.

## Run Proportionate Checks

- Iteration: the manual runner defaults to quick.
- Functional completion: use --level standard.
- Relevant performance/release evidence: use --level release and required manual scenarios.
- Explicit full bound-check sweep: --all defaults to release. Legacy untiered rules retain their original checks.

The runner selects local commands plus root path rules. Escalations remain manual. The structural checker validates configuration, command references, and routing; structural success does not prove behavioral coverage. Commands, report format, and execution limits belong to the validation guide.

## Keep the Boundaries Clear

Repository harness/ contains maintained knowledge, tools, protocols, and check definitions. .pulse-coder/ is product runtime configuration and skills. Generated .harness/ output holds reports or runtime artifacts and is not durable Knowledge.

Prefer mechanisms over duplicated prose, state unimplemented gates honestly, and keep facts near their owners. Current automatic-trigger status and qualification criteria are tracked in ROADMAP.md.
