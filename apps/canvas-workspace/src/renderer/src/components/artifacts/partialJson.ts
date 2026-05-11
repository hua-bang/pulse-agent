/**
 * Streaming JSON helpers — extract a single string field from a JSON document
 * that may still be in the middle of being emitted by the LLM.
 *
 * We can't use `JSON.parse` mid-stream: the trailing braces / quotes aren't
 * there yet. Instead we scan for `"<field>"\s*:\s*"` and then walk character
 * by character, honoring backslash escapes, until we hit an unescaped closing
 * quote (string complete) or EOF (string still being emitted, return what we
 * have so far).
 *
 * This is intentionally NOT a full JSON parser — it only handles the
 * top-level fields of the `visual_render` / `artifact_create` tool inputs.
 * Object nesting inside the target field's value is not supported (we expect
 * `content` etc. to be plain strings).
 */

/**
 * Return the (possibly partial) value of `"<field>": "..."` from a JSON
 * string fragment. Returns `undefined` if the field/value-opening hasn't been
 * emitted yet, or the (possibly partial) string content otherwise.
 *
 * The result is fully unescaped: `\n` becomes a real newline, `\"` becomes a
 * literal quote, etc., so it can be passed straight to an iframe or DOM.
 */
export function extractPartialStringField(json: string, field: string): string | undefined {
  // Match `"field"`<ws>`:`<ws>`"` — start of the string value.
  // Escape the field name for the regex; field names in the tool schema are
  // simple identifiers so this is safe.
  const re = new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`);
  const match = json.match(re);
  if (!match || match.index === undefined) return undefined;

  let i = match.index + match[0].length;
  let out = '';

  while (i < json.length) {
    const ch = json[i];
    if (ch === '\\') {
      // Escape sequence. If we don't have the second char yet, return what we
      // have (the next delta will resume the scan from this position).
      if (i + 1 >= json.length) return out;
      const next = json[i + 1];
      switch (next) {
        case 'n': out += '\n'; i += 2; break;
        case 't': out += '\t'; i += 2; break;
        case 'r': out += '\r'; i += 2; break;
        case '"': out += '"'; i += 2; break;
        case '\\': out += '\\'; i += 2; break;
        case '/': out += '/'; i += 2; break;
        case 'b': out += '\b'; i += 2; break;
        case 'f': out += '\f'; i += 2; break;
        case 'u': {
          // \uXXXX — need 4 more hex chars. If incomplete, return what we have.
          if (i + 5 >= json.length) return out;
          const hex = json.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            // Malformed escape — bail with current accumulator.
            return out;
          }
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          break;
        }
        default:
          // Unknown escape — emit the literal character and move on.
          out += next;
          i += 2;
      }
    } else if (ch === '"') {
      // Unescaped quote — string is closed.
      return out;
    } else {
      out += ch;
      i += 1;
    }
  }

  // Reached EOF mid-string. Return the accumulator; the next delta will
  // continue from where we left off (callers re-run this each tick).
  return out;
}
