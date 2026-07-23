/**
 * Exact string edits against an artifact version's content — the agent-side
 * alternative to regenerating the full document on every iteration. Each
 * edit's `old_str` must match the running content exactly once (same rule
 * as file-edit tools); edits apply sequentially, so a later edit may match
 * text produced by an earlier one. Failures return an error instead of
 * guessing — the model retries with full content. The applied result is
 * stored as a normal full version; storage never sees diffs.
 */

export interface ArtifactEdit {
  old_str: string;
  new_str: string;
}

export type ApplyEditsResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export function applyArtifactEdits(content: string, edits: ArtifactEdit[]): ApplyEditsResult {
  if (edits.length === 0) {
    return { ok: false, error: 'edits is empty — pass at least one edit or use content instead' };
  }
  let current = content;
  for (let i = 0; i < edits.length; i++) {
    const { old_str: oldStr, new_str: newStr } = edits[i];
    if (!oldStr) {
      return { ok: false, error: `edit #${i + 1}: old_str is empty` };
    }
    const occurrences = current.split(oldStr).length - 1;
    if (occurrences === 0) {
      return {
        ok: false,
        error: `edit #${i + 1}: old_str not found in the current version — `
          + 'check the exact text (including whitespace) or resend the full content instead',
      };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        error: `edit #${i + 1}: old_str appears ${occurrences} times — `
          + 'include more surrounding context to make it unique',
      };
    }
    current = current.replace(oldStr, () => newStr);
  }
  return { ok: true, content: current };
}
