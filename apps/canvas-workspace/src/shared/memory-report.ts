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
}

export interface MemoryReportApi {
  /**
   * Generate a memory report right now (user-initiated — not gated by the
   * scheduled-memory-report flag; clicking is explicit consent to one LLM
   * run). Resolves when generation finishes; concurrent calls share one run.
   */
  runNow: () => Promise<MemoryReportRunResult>;
}
