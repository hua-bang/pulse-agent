import type {
  WebReadInput,
  WebReadResult,
  WebSelectionInput,
  WebSelectionResult,
} from '../web';

export type * from '../web';

export interface WebApi {
  read: (payload: WebReadInput) => Promise<WebReadResult>;
  /** Read the text the user selected in a registered webview. */
  readSelection: (payload: WebSelectionInput) => Promise<WebSelectionResult>;
}
