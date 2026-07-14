export type BrowserLoadState = 'idle' | 'loading' | 'ready' | 'failed';

export interface BrowserLoadError {
  code?: number;
  description?: string;
}

export interface EmbeddedWebviewTag extends HTMLElement {
  getWebContentsId(): number;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  isCurrentlyAudible(): boolean;
  isDevToolsOpened(): boolean;
  isLoading(): boolean;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
}
