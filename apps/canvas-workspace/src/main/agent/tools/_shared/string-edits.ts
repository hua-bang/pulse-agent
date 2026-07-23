/**
 * Exact string edits against a text body — the agent-side alternative to
 * regenerating a full document on every iteration. Shared by
 * `artifact_update` and `canvas_update_node`. Each edit's `old_str` must
 * match the running content exactly once (same rule as file-edit tools);
 * edits apply sequentially, so a later edit may match text produced by an
 * earlier one. Failures return an error instead of guessing — the model
 * retries with full content. Callers store the applied result as a normal
 * full write; storage never sees diffs.
 */

export interface StringEdit {
  old_str: string;
  new_str: string;
}

export type ApplyStringEditsResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export function applyStringEdits(content: string, edits: StringEdit[]): ApplyStringEditsResult {
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
        error: `edit #${i + 1}: old_str not found in the current content — `
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
