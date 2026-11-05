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

export interface WebSelectionInput {
  workspaceId: string;
  nodeId: string;
  /** Max characters of selected text. Defaults to 8 000. */
  maxChars?: number;
}

/**
 * The text the user selected in a live page. `text` is empty when nothing is
 * selected. `before` and `after` hold a short piece of the surrounding text
 * in the same block, so a caller can place the quote in the page.
 */
export interface WebSelection {
  text: string;
  before: string;
  after: string;
  truncated: boolean;
  title: string;
  url: string;
  /** URL of the frame that holds the selection, when it is not the top page. */
  frameUrl?: string;
}

export type WebSelectionResult =
  | ({ ok: true; nodeId: string } & WebSelection)
  | { ok: false; nodeId: string; error: string };
