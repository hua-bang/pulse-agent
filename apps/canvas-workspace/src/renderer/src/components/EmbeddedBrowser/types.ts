export type BrowserLoadState = 'idle' | 'loading' | 'ready' | 'failed';

export interface BrowserLoadError {
  code?: number;
  description?: string;
}

export interface EmbeddedWebviewTag extends HTMLElement {
  getWebContentsId(): number;
  getTitle(): string;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
}
