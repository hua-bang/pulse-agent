# 2026-09-25 — S3 file repository decisions

Decision record for phase S3. Current behavior is described by the spec README
and the Knowledge owners it routes to.

## One content version scheme

- **Chosen:** `sha256:<hex>` over the file's bytes, produced by the storage
  package for reads, writes, dock previews and durable file write intents.
- **Rejected:** keeping the editor's bare hex digest next to the intents'
  prefixed digest. Two schemes for the same bytes made cross-checks between
  editor saves and intent recovery impossible without translation.
- **Compatibility:** node records already store bare digests in
  `fileSource.version`. `sameFileVersion` treats both forms as equal, so an
  upgrade does not rewrite every note record or broadcast a spurious change.

## Keep the editor's file semantics

- **Chosen:** the local adapter ports the editor save path rather than the
  intent recovery path. It edits a file reached through a symlink in place,
  never replaces a dangling symlink, keeps the file mode, decodes text
  leniently while versioning exact bytes, and serializes writes per real file
  in-process.
- **Rejected:** reusing intent recovery's stricter rules (no symlinked files,
  fatal UTF-8 decoding) for interactive editing, which would have broken notes
  that users keep behind symlinks.

## Scope of routing

- **Routed:** code that owns Markdown or attachment content in Canvas main.
- **Left direct, by design:** consumers that need a real path, such as
  `AGENTS.md`, terminal-agent prompt files, save-dialog exports to user-chosen
  locations, import staging directories, and legacy layout migration.
- **Behavior changes accepted:** deleting an already-missing saved image now
  succeeds; a versioned save to a file that disappeared reports a conflict
  instead of a raw `ENOENT` error.
- **Not changed:** `file:createNote` still overwrites a same-named note with
  an empty file, as before. Making it create-only is a separate UX decision.
