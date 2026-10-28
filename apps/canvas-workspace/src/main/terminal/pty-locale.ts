/**
 * A macOS GUI launch (Finder, Dock) gives the app no LANG. Terminal.app and
 * iTerm set one for their shells; without it, CLIs in our PTY run in the C
 * locale. Claude Code then pipes copied text to `pbcopy`, which reads the
 * UTF-8 bytes as Mac Roman, so pasted Chinese turns into "ÂêéÔºå...".
 *
 * Only fills the gap: an explicit LC_ALL, LC_CTYPE, or LANG wins.
 */
export function withUtf8Locale(
  env: Record<string, string>,
  os: NodeJS.Platform,
): Record<string, string> {
  if (os === "win32" || env.LC_ALL || env.LC_CTYPE || env.LANG) return env;
  // en_US.UTF-8 always exists on macOS; glibc and musl always ship C.UTF-8.
  return { ...env, LANG: os === "darwin" ? "en_US.UTF-8" : "C.UTF-8" };
}
