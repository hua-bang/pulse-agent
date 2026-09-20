import { z } from 'zod';

export const pageRunInputSchema = z.object({
  nodeId: z.string().min(1).describe('Existing iframe node or dock web-tab ID.'),
  goal: z.string().trim().min(1).max(4_000).describe('One bounded browser task; include required field values and when to stop.'),
  mode: z.enum(['act', 'read']).default('act').describe('read: collect the current document region to its bottom without clicks; act: interactive tasks.'),
  maxSteps: z.number().int().min(1).max(60).default(20),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(120_000),
});

export type PageRunInput = Omit<z.infer<typeof pageRunInputSchema>, 'mode'> & { mode?: 'act' | 'read' };
export type PageRunStatus = 'read_complete' | 'model_done' | 'handoff' | 'blocked' | 'needs_input' | 'unsupported' | 'budget_exhausted' | 'cancelled' | 'error';
export type ActionKind = 'click' | 'fill' | 'enter' | 'escape' | 'scroll_up' | 'scroll_down' | 'wait';

export interface PageTarget {
  ref: string;
  name: string;
  role: string;
  value: string;
  checked: string | null;
  expanded: string | null;
  requiresScroll?: boolean;
  href?: string;
  linkTarget?: string;
  operations: Array<'click' | 'fill' | 'enter'>;
}

export interface PageScrollArea {
  ref: string;
  name: string;
  role: string;
  top: number;
  height: number;
  width: number;
  scrollHeight: number;
  atTop: boolean;
  atBottom: boolean;
  signature?: string;
}

export interface PageReading {
  entries: Array<{
    step: number;
    url: string;
    title: string;
    text: string;
    scrollUp: boolean;
    scrollDown: boolean;
    scrollAreas: PageScrollArea[];
  }>;
  observations: number;
  characters: number;
  truncated: boolean;
}

export interface ReadingRegion {
  documentId: string;
  url: string;
  ref?: string;
  signature?: string;
}

export interface PageSnapshot {
  readingMode?: boolean;
  readingRegionLost?: boolean;
  loading?: boolean;
  id: string;
  documentId: string;
  url: string;
  title: string;
  text: string;
  fingerprint: string;
  targets: PageTarget[];
  scrollAreas?: PageScrollArea[];
  textTruncated?: boolean;
  scrollTop?: number;
  scrollHeight?: number;
  viewportHeight?: number;
  readingProgress?: { snapshots: number; characters: number; truncated: boolean; startedAtTop: boolean };
  truncated: boolean;
  scrollUp: boolean;
  scrollDown: boolean;
}

export interface PageAction {
  id: string;
  kind: ActionKind;
  description: string;
  target?: PageTarget;
  scrollArea?: PageScrollArea;
}

export interface PageDecision {
  action: string;
  confidence: number;
  goalDone: number;
  stuck: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface PageStep {
  step: number;
  proposed: string;
  description: string;
  executed: boolean;
  outcome: string;
  source?: 'jev' | 'program';
  confidence?: number;
  goalDone?: number;
  stuck?: number;
  elapsedMs: number;
  errorCode?: string;
}

export interface PageRunResult {
  timings?: Record<'observe' | 'decide' | 'text' | 'approve' | 'execute' | 'isFresh' | 'settle', number>;
  status: PageRunStatus;
  reason: string;
  verified: false;
  finalUrl?: string;
  evidence?: {
    title: string;
    text: string;
    scroll?: { top?: number; height?: number; scrollHeight?: number; atTop: boolean; atBottom: boolean };
    scrollAreas?: PageScrollArea[];
  };
  reading?: PageReading;
  steps: PageStep[];
  usage: { jevCalls: number; inputTokens: number; outputTokens: number; model?: string };
  openedPages?: Array<{ workspaceId: string; nodeId?: string; url: string; title?: string }>;
  elapsedMs: number;
  errorCode?: string;
}

export class PageRunStop extends Error {
  constructor(public readonly status: PageRunStatus, message: string, public readonly code?: string) {
    super(message);
    this.name = 'PageRunStop';
  }
}

/** Only emitted when no click, key press or field modification was dispatched. */
export class PageRunRetry extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PageRunRetry';
  }
}

export interface TargetInspection {
  status: 'ready' | 'scrolled' | 'needs_scroll' | 'revealed' | 'stale' | 'blocked';
  reason?: string;
}

export interface PageRunPorts {
  observe(signal: AbortSignal, region?: ReadingRegion): Promise<PageSnapshot>;
  isFresh(snapshot: PageSnapshot, signal: AbortSignal, action?: PageAction): Promise<boolean>;
  decide(goal: string, snapshot: PageSnapshot, actions: PageAction[], history: PageStep[], signal: AbortSignal): Promise<PageDecision>;
  text(goal: string, target: PageTarget, snapshot: PageSnapshot, signal: AbortSignal): Promise<string>;
  approve(action: PageAction, text: string | undefined, step: number, signal: AbortSignal): Promise<boolean>;
  execute(action: PageAction, snapshot: PageSnapshot, text: string | undefined, signal: AbortSignal): Promise<void>;
  settle?(signal: AbortSignal): Promise<void>;
  getOpenedPages?(): NonNullable<PageRunResult['openedPages']>;
}
