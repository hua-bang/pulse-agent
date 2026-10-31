/** Pure so the trusted worker can embed the same bounded-preview function. */
export function truncateCodemodeText(text: string, limit: number, forceMarker = false): string {
  if (text.length <= limit && !forceMarker) return text;
  const marker = '\n...[Codemode output truncated]...\n';
  if (limit <= marker.length) return marker.slice(0, limit);
  const retained = Math.min(text.length, limit - marker.length);
  let headEnd = Math.ceil(retained / 2);
  let tailStart = text.length - Math.floor(retained / 2);
  // UTF-16 budgets must not cut an emoji's surrogate pair in half.
  const head = text.charCodeAt(headEnd - 1);
  const tail = text.charCodeAt(tailStart);
  if (head >= 0xD800 && head <= 0xDBFF) headEnd--;
  if (tail >= 0xDC00 && tail <= 0xDFFF) tailStart++;
  return text.slice(0, headEnd) + marker + text.slice(tailStart);
}
