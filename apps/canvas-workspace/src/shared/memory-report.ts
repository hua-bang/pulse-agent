/**
 * Cross-process contract for on-demand memory-report generation.
 * Runtime-neutral: JSON-safe shapes only (see architecture-boundaries.md).
 */

export interface MemoryReportRunResult {
  ok: boolean;
  /** Global-scope artifact id of the generated report (on success). */
  artifactId?: string;
  /** On-disk archive path of the generated report (on success). */
  path?: string;
  error?: string;
  /** True when the run was cancelled by the user (not a real failure). */
  cancelled?: boolean;
}

export interface MemoryReportProgress {
  /** Coarse generation phase: reading sessions → writing the document. */
  phase: 'reading' | 'writing';
}

export interface MemoryReportApi {
  /**
   * Generate a memory report right now (user-initiated — not gated by the
   * scheduled-memory-report flag; clicking is explicit consent to one LLM
   * run). Resolves when generation finishes; concurrent calls share one run.
   */
  runNow: () => Promise<MemoryReportRunResult>;
  /** Cancel the in-flight run, if any. */
  cancel: () => Promise<{ ok: boolean }>;
  /** Progress pushes for any in-flight run. Returns unsubscribe fn. */
  onProgress: (callback: (progress: MemoryReportProgress) => void) => () => void;
}
