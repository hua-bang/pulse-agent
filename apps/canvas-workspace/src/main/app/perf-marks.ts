import { performance } from 'node:perf_hooks';

// ── Startup performance marks (L3) ──────────────────────────────────────────
//
// Records main-process bootstrap phase timestamps so time-to-window and the
// per-phase breakdown can be measured (findings D1/D2, and a regression guard
// for the shipped E1/D1 fixes). Gated by PULSE_PERF=1: when unset, recordMark
// is a no-op and nothing is retained, so production pays nothing.
//
// The detachable perf plugin reads these via getStartupReport(); core never
// depends on the plugin.

const ENABLED = !!process.env.PULSE_PERF;

interface PerfMark {
  name: string;
  /** ms since process start (performance.now() origin). */
  t: number;
}

const marks: PerfMark[] = [];

export const isPerfEnabled = (): boolean => ENABLED;

export const recordMark = (name: string): void => {
  if (!ENABLED) return;
  marks.push({ name, t: performance.now() });
};

export interface StartupPhase {
  name: string;
  ms: number;
}

export interface StartupReport {
  enabled: boolean;
  marks: PerfMark[];
  phases: StartupPhase[];
}

export const getStartupReport = (): StartupReport => {
  const phases: StartupPhase[] = [];
  for (let i = 1; i < marks.length; i++) {
    phases.push({
      name: `${marks[i - 1].name} → ${marks[i].name}`,
      ms: Math.round((marks[i].t - marks[i - 1].t) * 10) / 10,
    });
  }
  return { enabled: ENABLED, marks: [...marks], phases };
};
