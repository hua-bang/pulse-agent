# Harness Checks

This directory is reserved for future mechanical checks that keep the repository harness from drifting.

No checks are enforced in the first pilot.

Candidate checks:

- `profile-coverage`: every `harness/profile.yaml` workspace path exists.
- `agents-coverage`: pilot workspaces have an entry file.
- `routing-links`: paths in `harness/README.md` and workspace entries exist or are marked as deferred.
- `skill-frontmatter`: `harness/skills/*.md` has `name` and `description` frontmatter.
- `validation-matrix`: commands in `harness/validation.yaml` reference known package names.

When a check becomes executable, keep the protocol here and place implementation in `scripts/harness/` unless there is a strong reason to colocate code.
