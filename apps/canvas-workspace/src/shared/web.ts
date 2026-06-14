export type WebReadStrategy = 'auto' | 'dom' | 'a11y' | 'screenshot';

export interface WebReadInput {
  workspaceId: string;
  nodeId: string;
  strategy?: WebReadStrategy;
  maxChars?: number;
  sparseThreshold?: number;
}

export type WebReadResult =
  | { ok: true; nodeId: string; strategy: 'dom'; text: string; title: string; url: string }
  | { ok: true; nodeId: string; strategy: 'a11y'; text: string }
  | { ok: true; nodeId: string; strategy: 'screenshot'; imagePath: string }
  | { ok: false; nodeId: string; strategy: WebReadStrategy; error: string };
