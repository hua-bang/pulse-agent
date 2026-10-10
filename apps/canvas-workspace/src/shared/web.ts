export type WebReadStrategy = 'auto' | 'dom' | 'a11y' | 'screenshot';

export interface WebReadInput {
  workspaceId: string;
  nodeId: string;
  strategy?: WebReadStrategy;
  /** Max characters for DOM text extraction. Defaults to 12 000. */
  maxChars?: number;
  /**
   * In auto mode, minimum extracted text length to be considered "useful"
   * before trying the next strategy. Defaults to 200.
   */
  sparseThreshold?: number;
}

export type WebReadResult =
  | { ok: true; nodeId: string; strategy: 'dom'; text: string; title: string; url: string }
  | { ok: true; nodeId: string; strategy: 'a11y'; text: string }
  | { ok: true; nodeId: string; strategy: 'screenshot'; imagePath: string }
  | { ok: false; nodeId: string; strategy: WebReadStrategy; error: string };
